import { Router } from 'express';
import { prisma } from '../server';
import { AuthRequest } from '../middleware/authMiddleware';
import { SKILLS, runSkill, aiConfigured, aiEnabled, tierAllows, AiUnavailableError } from '../lib/ai';
import { isModuleEnabled } from '../lib/modules';
import { clientScope } from '../lib/access';

const router = Router();

// Builds a plain-text fact sheet from CRM records the caller can see
async function buildContext(req: AuthRequest, propertyId?: string, clientId?: string) {
    const user = req.user!;
    const lines: string[] = [];
    const me = await prisma.user.findUnique({ where: { id: user.userId }, select: { name: true, title: true, phone: true } });
    if (me) lines.push(`Agent: ${me.name}${me.title ? `, ${me.title}` : ''}${me.phone ? ` (${me.phone})` : ''}`);

    if (propertyId) {
        const p = await prisma.property.findFirst({ where: { id: propertyId, orgId: user.orgId } });
        if (!p) return { error: 'Property not found' };
        lines.push('Property:',
            `  Address: ${[p.address, p.locality, p.city, p.state].filter(Boolean).join(', ')}`,
            `  Price: ${p.price != null ? `$${p.price.toLocaleString()}` : 'on request'}${p.beds != null ? ` | ${p.beds} bed` : ''}${p.baths != null ? ` / ${p.baths} bath` : ''}${p.builtAreaM2 ? ` | ${p.builtAreaM2} m²` : p.sqft ? ` | ${p.sqft} sq ft` : ''}${p.landArea ? ` | land ${p.landArea} ${p.landAreaUnit === 'HA' ? 'ha' : 'm²'}` : ''}`,
            p.propertyType ? `  Type: ${p.propertyType}` : '',
            p.neighborhood ? `  Neighbourhood: ${p.neighborhood}` : '',
            p.yearBuilt ? `  Year built: ${p.yearBuilt}` : '',
            p.hoaFee ? `  HOA / common charges: $${p.hoaFee}/month` : '',
            p.parkingSpaces ? `  Parking: ${p.parkingSpaces}` : '',
            `  Status: ${p.status}`,
            p.description ? `  Agent notes / current description: ${p.description}` : '');
    }
    if (clientId) {
        const c = await prisma.client.findFirst({
            where: { id: clientId, ...clientScope(user) },
            include: { clientNotes: { orderBy: { createdAt: 'desc' }, take: 5 } },
        });
        if (!c) return { error: 'Client not found' };
        lines.push('Client:',
            `  Name: ${c.firstName} ${c.lastName}`,
            `  Type: ${c.type} | Stage: ${c.funnelStage}${c.temperature ? ` | Priority: ${c.temperature}` : ''}`,
            c.budget ? `  Budget: ${c.budget}` : '',
            c.preferredContact ? `  Prefers contact by: ${c.preferredContact}` : '',
            c.lastContactedAt ? `  Last contacted: ${c.lastContactedAt.toISOString().slice(0, 10)}` : '  Last contacted: never',
            c.notes ? `  Notes: ${c.notes}` : '',
            ...c.clientNotes.map(n => `  [${n.createdAt.toISOString().slice(0, 10)} ${n.type}] ${n.content.slice(0, 400)}`));
    }
    return { context: lines.filter(Boolean).join('\n') };
}

// GET /api/marketing/skills — catalogue of AI skills and whether each is unlocked
router.get('/skills', (req: AuthRequest, res) => {
    const user = req.user!;
    res.json({
        enabled: aiEnabled(),
        configured: aiConfigured(),
        skills: SKILLS.map(s => ({
            id: s.id, name: s.name, description: s.description, minTier: s.minTier,
            uses: s.uses, inputLabel: s.inputLabel,
            unlocked: tierAllows(user.tier, user.role, s.minTier),
        })),
    });
});

// POST /api/marketing/assist — run an AI skill against CRM records
router.post('/assist', async (req: AuthRequest, res) => {
    const user = req.user!;
    const skill = SKILLS.find(s => s.id === req.body.skill);
    if (!skill) return res.status(400).json({ error: 'Unknown skill' });
    if (!tierAllows(user.tier, user.role, skill.minTier)) {
        return res.status(403).json({ error: `${skill.name} requires a ${skill.minTier} plan.`, requiredTier: skill.minTier });
    }
    const input = typeof req.body.input === 'string' ? req.body.input.slice(0, 2000) : '';
    if (skill.id === 'objection_handler' && !input.trim()) {
        return res.status(400).json({ error: 'Type the objection you want to answer' });
    }
    const built = await buildContext(req, req.body.propertyId || undefined, req.body.clientId || undefined);
    if ('error' in built) return res.status(400).json({ error: built.error });

    try {
        const text = await runSkill(skill, {
            context: built.context!,
            input,
            language: typeof req.body.language === 'string' ? req.body.language : 'en',
            tone: tierAllows(user.tier, user.role, 'ELITE') && typeof req.body.tone === 'string' ? req.body.tone.slice(0, 100) : undefined,
        });
        res.json({ generatedContent: text, skill: skill.id });
    } catch (e: any) {
        if (e instanceof AiUnavailableError) return res.status(503).json({ error: e.message });
        console.error('AI skill failed:', e);
        res.status(502).json({ error: 'The AI assistant is temporarily unavailable. Please try again.' });
    }
});

// POST /api/marketing/generate
// Listing / social / email copy. Uses Claude when configured, otherwise built-in templates.
router.post('/generate', async (req: AuthRequest, res) => {
    try {
        const { propertyId, features, language, type = 'LISTING', tone } = req.body;
        const audience = typeof req.body.audience === 'string' ? req.body.audience : 'general buyers';
        const userTier = req.user?.tier || 'CORE';

        // 1. Tier-based Type Gating
        if (type !== 'LISTING' && userTier === 'CORE') {
            return res.status(403).json({ 
                error: 'Social and Email generation require a PRO subscription.',
                requiredTier: 'PRO'
            });
        }

        // 2. Tier-based Tone Gating
        if (tone && userTier !== 'ELITE') {
            return res.status(403).json({ 
                error: 'Custom Tone of Voice requires an ELITE subscription.',
                requiredTier: 'ELITE'
            });
        }

        // Without the AI module the built-in templates are used, as when no API key is set.
        if (aiConfigured() && await isModuleEnabled(req.user!.orgId, 'aiAssistant')) {
            const skillId = type === 'SOCIAL' ? 'social_post' : type === 'EMAIL' ? 'listing_email' : 'listing_description';
            const skill = SKILLS.find(s => s.id === skillId)!;
            const realProperty = typeof propertyId === 'string' && propertyId && propertyId !== 'mock-id' ? propertyId : undefined;
            const built = await buildContext(req, realProperty);
            if ('error' in built) return res.status(400).json({ error: built.error });
            try {
                const text = await runSkill(skill, {
                    context: built.context!,
                    input: `Target audience: ${audience}${features ? `\nKey features: ${features}` : ''}`,
                    language, tone,
                });
                return res.json({ generatedContent: text, source: 'ai' });
            } catch (e) {
                console.error('AI generation failed, falling back to template:', e);
            }
        }

        res.json({ generatedContent: templateCopy(type, audience, features, language), source: 'template' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate content' });
    }
});

function templateCopy(type: string, audience: string, features: string | undefined, language: string | undefined): string {
    let text = "";

    const isZh = language === 'zh';
    const isEs = language === 'es';

    if (type === 'SOCIAL') {
        if (isZh) {
            text = `🏠 新房源警报！\n\n看看这处位于 ${features || '绝佳地段'} 的${audience.includes('luxury') ? '奢华豪宅' : '现代住宅'}。✨\n\n✅ 精美的室内设计\n✅ 环境优雅\n✅ 拎包入住\n\n立即联系我看房！#房产 #豪宅 #新房源`;
        } else if (isEs) {
            text = `🏠 ¡NUEVA PROPIEDAD EN EL MERCADO!\n\nEcha un vistazo a esta increíble residencia en ${features || 'una ubicación premium'}. ✨\n\n✅ Interiores modernos\n✅ Ubicación perfecta\n✅ Lista para mudarse\n\n¡Contáctame hoy para una visita! #BienesRaices #Lujo #NuevaPropiedad`;
        } else {
            text = `🏠 NEW LISTING ALERT!\n\nCheck out this incredible ${audience.includes('luxury') ? 'luxury' : 'modern'} residence featuring ${features || 'premium finishes'}. ✨\n\n✅ Stunning interiors\n✅ Prime location\n✅ Move-in ready\n\nContact me today for a private tour! #RealEstate #LuxuryLiving #NewListing`;
        }
    } else if (type === 'EMAIL') {
        if (isZh) {
            text = `主题: 专属房源机会: ${features || '极致景观住宅'}\n\n尊敬的客户，\n\n我想向您推荐一处非常符合您品味的新房源。这处房源专为 ${audience} 打造，拥有 ${features || '顶级配套'}。\n\n如果您感兴趣，我可以为您安排优先看房体验。\n\n祝好，\n您的房产顾问`;
        } else if (isEs) {
            text = `Asunto: Oportunidad Exclusiva: Propiedad en ${features || 'Ubicación Premium'}\n\nEstimado cliente,\n\nQuería compartir con usted una nueva propiedad que encaja perfectamente con sus intereses. Diseñada para ${audience}, cuenta con ${features || 'excelentes acabados'}.\n\nSi le interesa, puedo organizar una visita privada exclusiva para usted.\n\nSaludos,\nSu Asesor Inmobiliario`;
        } else {
            text = `Subject: Exclusive Property Opportunity: ${features || 'Prime Residence'}\n\nDear Client,\n\nI wanted to share a new listing that perfectly matches your interests. Tailored for ${audience}, this property features ${features || 'stunning amenities'}.\n\nIf this looks like a fit, I'd be happy to arrange a priority viewing for you.\n\nBest regards,\nYour Real Estate Advisor`;
        }
    } else if (audience.toLowerCase().includes('luxury') || audience.toLowerCase().includes('elegant')) {
        if (isZh) {
            text = `在令人叹为观止的奢华宅邸中，探索高雅生活的极致缩影。每一处细节都经过精心雕琢，满足最为挑剔的品味，散发出低调而不可妥协的奢华光彩。\n\n从您踏入宏伟门厅的那一刻起，便被量身定制的饰面与宏大且具建筑意义的空间感所包围。自然光穿透落地平开窗，照亮了精心布置的${features ? `细节，包括 ${features}` : '室内空间'}。\n\n这里不仅适合举办盛大的宴会，亦是静谧深思的绝佳私密之所。起居空间之间的无缝衔接，创造了无与伦比的待客与放松环境。主卧套房宛如一处真正的圣所，配备如水疗般的设施和堪比全球最顶级精品的定制衣帽间。\n\n这不仅仅是一处住所，更是非凡成就的象征。在这座罕见且宏伟的物业中提升您的生活水准。请联系我们的私人顾问团队，为您安排一次低调的私密看房。`;
        } else if (isEs) {
            text = `Descubra el paradigma de la vida refinada en esta impresionante residencia. Magisterialmente ejecutada para satisfacer los gustos más exigentes, cada rincón de este hogar destila una aura de elegancia discreta y lujo sin concesiones.\n\nDesde el momento en que cruza la gran entrada, se ve envuelto en un mundo de acabados a medida y volúmenes arquitectónicamente significativos. La luz natural cae a través de las ventanas de piso a techo, iluminando los meticulosamente cuidados ${features ? `detalles, incluyendo ${features}` : 'interiores'}.\n\nDiseñada para entretenimientos a gran escala pero lo suficientemente íntima para momentos de reflexión, la transición perfecta entre los espacios crea un entorno inigualable para ser anfitrión y relajarse. La suite principal es un verdadero santuario, con comodidades de spa y vestidores que rivalizan con las mejores boutiques del mundo.\n\nEsto no es solo una residencia; es una declaración de éxito extraordinario. Eleve su nivel de vida en una propiedad que es tan rara como magnífica. Contacte a nuestro equipo de asesoría privada para organizar una visita discreta de esta obra maestra.`;
        } else {
            text = `Discover the epitome of refined living in this breathtaking residence. Masterfully executed to cater to the most discerning tastes, every inch of this home exudes an aura of understated elegance and uncompromising luxury.\n\nFrom the moment you step through the grand entrance, you are enveloped in a world of bespoke finishes and soaring, architecturally significant volumes. Natural light cascades through floor-to-ceiling casement windows, illuminating the meticulously curated ${features ? `details, including ${features}` : 'interiors'}.\n\nDesigned for grand-scale entertaining yet intimate enough for quiet moments of reflection, the seamless flow between the living spaces creates an unparalleled environment for both hosting and unwinding. The primary suite serves as a true sanctuary, featuring spa-like amenities and bespoke dressing rooms that rival the world's finest boutiques.\n\nThis is not just a residence; it is a statement of extraordinary achievement. Elevate your standard of living in a property that is as rare as it is magnificent. Contact our private advisory team to arrange a discrete viewing of this masterpiece.`;
        }
    } else if (audience.toLowerCase().includes('young') || audience.toLowerCase().includes('professional')) {
        if (isZh) {
            text = `步入未来都市生活。这个极具现代感的光洁空间，专为今日雄心勃勃的职场精英量身打造。坐落于文化、商业与创意的交汇核芯，这里不仅是一个家，更是您事业腾飞的终极发射台。\n\n室内设计在工业风与现代温馨之间取得了完美平衡。开放式生活区营造出开阔的空间感，使每一平方英尺都发挥出最大的效用。${features ? `令人瞩目的特色包括 ${features}，确保您的生活空间与您一样高效。` : '智能家居集成与高级科技设施无缝融入设计之中。'}\n\n不论是周末与好友的即兴聚会，还是在专属的家庭办公角专注下一个重大项目，这个住宅都能轻松适应您的生活节奏。周边街区活力四射，瞬间连接手工咖啡馆、健身工作室及城中最热门的餐饮圣地。\n\n在天际线中宣告您的位置。今天就预约参观，体验终极的都市静居。`;
        } else if (isEs) {
            text = `Adéntrese en el futuro de la vida urbana. Este espacio elegante e hipermoderno está meticulosamente diseñado para el estilo de vida dinámico de los profesionales ambiciosos de hoy. Situada en el nexo de la cultura, el comercio y la creatividad, esta propiedad no es solo un hogar, es tu plataforma de lanzamiento definitiva.\n\nLos interiores logran un equilibrio perfecto entre la elegancia industrial y la calidez moderna. Las áreas de estar de concepto abierto crean una sensación de amplitud, maximizando cada metro cuadrado para su máxima utilidad. ${features ? `Las características destacadas incluyen ${features}, asegurando que tu espacio trabaje tan duro como tú.` : 'Las integraciones de hogares inteligentes y comodidades tecnológicas premium se entrelazan perfectamente en el diseño.'}\n\nYa sea que organices una reunión improvisada el fin de semana con amigos o te concentres en tu próxima gran aventura en el rincón dedicado para la oficina en el hogar, esta residencia se adapta sin esfuerzo a tu ritmo. El barrio circundante vibra con energía, ofreciendo acceso instantáneo a cafeterías artesanales, estudios de fitness y los lugares de comida más comentados de la ciudad.\n\nReclama tu espacio en el horizonte. Programa un recorrido hoy y experimenta el último refugio urbano.`;
        } else {
            text = `Step into the future of urban living. This sleek, hyper-modern space is meticulously engineered for the dynamic lifestyle of today's ambitious professionals. Positioned at the very nexus of culture, commerce, and creativity, this property isn't just a home—it's your ultimate launchpad.\n\nThe interiors strike a perfect balance between industrial chic and modern warmth. Open-concept living areas create an expansive feel, maximizing every square foot for ultimate utility. ${features ? `Standout features include ${features}, ensuring your space works as hard as you do.` : 'Smart home integrations and premium tech-forward amenities are woven seamlessly into the design.'}\n\nWhether you're hosting an impromptu weekend gathering with friends or focusing on your next big venture in the dedicated home-office alcove, this residence adapts effortlessly to your rhythm. The surrounding neighborhood pulses with energy, offering instant access to artisanal coffee shops, fitness studios, and the city's most talked-about dining spots.\n\nClaim your space in the skyline. Schedule a tour today and experience the ultimate urban retreat.`;
        }
    } else {
        // Family or general
        if (isZh) {
            text = `欢迎来到这个充满珍贵回忆的居所。精心设计的宽敞大宅，融合了温馨、舒适与极致的实用性，为您家庭的下一个篇章提供了完美的画卷。\n\n大气的空间比例和直观的布局，确保每个人都有充裕的聚会空间，同时也为静思或放松提供了私密退所。住宅的核心是其壮观的厨师级厨房，它与主要生活区流畅相连——无论是生机勃勃的清晨还是温馨舒适的夜晚都再适合不过。\n\n${features ? `每一处细节都经过深思熟虑，以提升您的日常生活体验，包括 ${features}。` : ''}在住宅之外，该物业还毗邻原始公园、顶尖学府，并拥有无与伦比的温馨社区氛围。\n\n发现奢华与实用的完美平衡。不要仅仅是买一栋房子，而是为您的家族锁定一份传承。请今天就联系我们的顾问团队，探索这个绝佳机会。`;
        } else if (isEs) {
            text = `Bienvenido a una residencia donde se están esperando crear recuerdos entrañables. Cuidadosamente diseñado con calidez, comodidad y una utilidad inquebrantable, este hogar espacioso ofrece el lienzo perfecto para el próximo capítulo de su familia.\n\nLas proporciones generosas y un diseño intuitivo aseguran que haya un abundante espacio para que todos se reúnan, mientras aún ofrece refugios privados para un enfoque tranquilo o relajación. El corazón de la casa es su espectacular cocina de chef, que fluye sin esfuerzo hacia las áreas de estar principales, perfecta tanto para mañanas vibrantes como para noches acogedoras.\n\n${features ? `Cada detalle ha sido altamente considerado para mejorar su rutina diaria, incluyendo ${features}. ` : ''}Más allá de los muros del hogar, la propiedad cuenta con acceso a parques vírgenes, escuelas de primer nivel y una atmósfera comunitaria acogedora que no tiene igual.\n\nDescubra el equilibrio perfecto entre lujo y practicidad. No compre simplemente una casa; asegure un legado para su familia. Comuníquese con nuestro equipo de asesores para explorar esta oportunidad excepcional hoy.`;
        } else {
            text = `Welcome to a residence where cherished memories are waiting to be made. Thoughtfully designed with warmth, comfort, and uncompromising utility, this expansive home offers the perfect canvas for your family's next chapter.\n\nGenerous proportions and an intuitive layout ensure that there is abundant space for everyone to gather, while still offering private retreats for quiet focus or relaxation. The heart of the home is its spectacular chef's kitchen, which flows effortlessly into the main living areas—perfect for vibrant mornings and cozy evenings alike.\n\n${features ? `Every detail has been highly considered to enhance your daily routine, including ${features}. ` : ''}Beyond the walls of the home, the property boasts access to pristine parks, top-tier schools, and a welcoming community atmosphere that is second to none.\n\nDiscover the perfect balance of luxury and practicality. Don't simply buy a house; secure a legacy for your family. Reach out to our advisory team to explore this exceptional opportunity today.`;
        }
    }

    return text;
}

export default router;
