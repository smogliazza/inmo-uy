"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useI18n, SUPPORTED_LANGUAGES } from "@/lib/i18n/I18nContext";
import { useTheme, ThemeName } from "@/lib/theme/ThemeContext";
import { useInstallationModules } from "@/lib/modules";
import { useAuth } from "@/lib/auth/AuthContext";

const FEATURED_SLUG = process.env.NEXT_PUBLIC_FEATURED_BROKERAGE_SLUG || "";
const LISTINGS_HREF = `/public-listings?b=${FEATURED_SLUG}`;

interface LandingCopy {
  nav: {
    browseListings: string;
    dashboard: string;
    signIn: string;
    getStarted: string;
  };
  hero: {
    badge: string;
    titleLine1: string;
    titleHighlight: string;
    subtitle: string;
    ctaPrimary: string;
    ctaDashboard: string;
    ctaBrowse: string;
    note: string;
  };
  featuresTitle: string;
  featuresSubtitle: string;
  features: { icon: string; title: string; desc: string }[];
  pricingTitle: string;
  pricingSubtitle: string;
  plans: {
    name: string;
    price: string;
    sub: string;
    highlight: boolean;
    cta: string;
    features: string[];
  }[];
  faqTitle: string;
  faqs: { q: string; a: string }[];
  cta: {
    title: string;
    subtitle: string;
    button: string;
  };
  footer: {
    tagline: string;
    rights: string;
  };
}

const COPY: Record<string, LandingCopy> = {
  en: {
    nav: {
      browseListings: "Browse Listings",
      dashboard: "Go to Dashboard →",
      signIn: "Sign In",
      getStarted: "Get Started Free",
    },
    hero: {
      badge: "Built for Modern Real Estate Brokerages",
      titleLine1: "The CRM Built for",
      titleHighlight: "Real Estate Agents",
      subtitle:
        "Manage clients, listings, deals, and commissions — all in one place. Trusted by luxury brokerages and high-performing teams. Free to start.",
      ctaPrimary: "Start Free → No credit card",
      ctaDashboard: "Enter CRM Dashboard →",
      ctaBrowse: "Browse Listings",
      note: "Free plan available · No credit card required · 4 Languages (EN / 简 / 繁 / ES)",
    },
    featuresTitle: "Everything a Modern Brokerage Needs",
    featuresSubtitle:
      "From first lead to commission payout — manage your entire business without switching tabs.",
    features: [
      {
        icon: "👥",
        title: "CRM & Lead Pipeline",
        desc: "Track every client from first contact to closing. Automated lead routing, full activity timeline, and follow-up reminders.",
      },
      {
        icon: "🏠",
        title: "Listing Management",
        desc: "Add properties, upload photos directly, customize your brokerage public page slug, and bulk-import via CSV.",
      },
      {
        icon: "📊",
        title: "Deal Pipeline",
        desc: "Drag-and-drop Kanban board from Offer Review → In Contract → Clear to Close → Closed.",
      },
      {
        icon: "💰",
        title: "Commission Tracking",
        desc: "Automatic gross/net commission calculation, firm split waterfall, payout approvals, and YTD leaderboard.",
      },
      {
        icon: "✨",
        title: "AI Marketing Copilot",
        desc: "Generate listing descriptions, social posts, and email campaigns in seconds across multiple tones and languages.",
      },
      {
        icon: "📅",
        title: "Appointments & Calendar",
        desc: "Schedule showings, inspections, and meetings with automated email reminders and visual calendar links.",
      },
    ],
    pricingTitle: "Simple, Transparent Pricing",
    pricingSubtitle: "Start free. Upgrade when your brokerage grows.",
    plans: [
      {
        name: "Core",
        price: "Free",
        sub: "forever",
        highlight: false,
        cta: "Start Free",
        features: ["5 Active Listings", "CRM — up to 50 clients", "Basic Reports", "AI Listing Descriptions"],
      },
      {
        name: "Pro",
        price: "$49",
        sub: "per month",
        highlight: true,
        cta: "Get Started",
        features: [
          "Unlimited Listings",
          "Unlimited Clients & CSV Import",
          "Commission Waterfall",
          "Automated Lead Routing",
          "Full Analytics",
        ],
      },
      {
        name: "Elite",
        price: "$99",
        sub: "per month",
        highlight: false,
        cta: "Get Started",
        features: [
          "Everything in Pro",
          "Revenue Projections",
          "Custom Branding & URL Slug",
          "Priority Support",
          "Team Roles & Permissions",
        ],
      },
    ],
    faqTitle: "Frequently Asked Questions",
    faqs: [
      {
        q: "What is Real Estate CRM?",
        a: "Real Estate CRM is a cloud-based Customer Relationship Management platform designed specifically for real estate agents and brokerages. It unifies client management, property listings, deal pipelines, commission splits, and marketing in one platform.",
      },
      {
        q: "Is there a free plan available?",
        a: "Yes. The Core plan is completely free and includes up to 5 active listings, 50 clients, basic reports, and AI listing descriptions. No credit card required.",
      },
      {
        q: "How does commission tracking work?",
        a: "The system automatically calculates gross commission, firm split, and net agent payout for each transaction. You can view YTD totals, monthly charts, and request or approve payouts within the Finance module.",
      },
      {
        q: "Can I invite my whole team?",
        a: "Yes. Firm Admins can invite agents, managers, attorneys, and other team members via email. Each member gets role-based access permissions and automated lead routing.",
      },
      {
        q: "Does the platform support multiple languages?",
        a: "Yes. You can switch between English, Simplified Chinese (简体中文), Traditional Chinese (繁體中文), and Spanish (Español) at any time using the language selector in the top header.",
      },
    ],
    cta: {
      title: "Ready to close more deals?",
      subtitle: "Empower your real estate team today. Free to start, no credit card needed.",
      button: "Create Your Free Account →",
    },
    footer: {
      tagline: "Real Estate Agency CRM Platform",
      rights: "All rights reserved.",
    },
  },
  "zh-CN": {
    nav: {
      browseListings: "浏览公开房源",
      dashboard: "进入工作台 →",
      signIn: "登录系统",
      getStarted: "免费注册",
    },
    hero: {
      badge: "专为现代房地产经纪公司与团队打造",
      titleLine1: "新一代智能化",
      titleHighlight: "房地产经纪 CRM 系统",
      subtitle:
        "一站式管理客户线索、房源图库、交易管道与佣金分成。支持多语言切换、线索自动分配与 CSV 批量导入，助您高效成单。",
      ctaPrimary: "免费开始使用 → 无需信用卡",
      ctaDashboard: "进入 CRM 工作台 →",
      ctaBrowse: "浏览公开房源",
      note: "提供永久免费版 · 无需绑定信用卡 · 支持 4 种语言（简 / 繁 / EN / ES）",
    },
    featuresTitle: "现代房产经纪所需的一切功能",
    featuresSubtitle: "从首条线索捕获到佣金结算发放 —— 无需在多个表格和工具之间来回切换。",
    features: [
      {
        icon: "👥",
        title: "客户管理与线索分配",
        desc: "全程追踪每位客户从初次接触到成交的跟进时间线，支持按轮询或规则自动分配新线索。",
      },
      {
        icon: "🏠",
        title: "房源与公开展示页",
        desc: "支持本地多图上传、主图排序、CSV 批量导入房源，并可自定义公司专属公开房源短链接与品牌色。",
      },
      {
        icon: "📊",
        title: "可视化交易看板",
        desc: "拖拽式交易漏斗看板：报价审核 → 合同签署 → 待交割 → 成功结案，自动生成交割清单任务。",
      },
      {
        icon: "💰",
        title: "佣金计算与审批",
        desc: "自动核算总佣金、公司抽成与经纪人净收入，支持线上发起提现申请、主管审批及年度业绩排行。",
      },
      {
        icon: "✨",
        title: "AI 营销助手",
        desc: "数秒内生成多语种房源文案、社交媒体推文与客户开发邮件，支持多种行文风格切换。",
      },
      {
        icon: "📅",
        title: "带看预约与邮件提醒",
        desc: "轻松安排看房、验房与会议日程，支持新线索、预约前 24 小时及逾期任务的自动邮件提醒。",
      },
    ],
    pricingTitle: "简单透明的订阅方案",
    pricingSubtitle: "免费起步，随团队规模灵活升级。",
    plans: [
      {
        name: "Core 基础版",
        price: "免费",
        sub: "永久有效",
        highlight: false,
        cta: "免费注册",
        features: ["最多 5 套在售房源", "CRM 最多 50 位客户", "基础业绩报表", "AI 房源描述生成"],
      },
      {
        name: "Pro 专业版",
        price: "$49",
        sub: "每月",
        highlight: true,
        cta: "立即开始",
        features: [
          "无限房源数量",
          "无限客户与 CSV 批量导入",
          "佣金分成瀑布流核算",
          "线索自动分配规则",
          "完整数据分析报表",
        ],
      },
      {
        name: "Elite 旗舰版",
        price: "$99",
        sub: "每月",
        highlight: false,
        cta: "立即开始",
        features: [
          "包含 Pro 版全部功能",
          "未来营收预测模型",
          "自定义品牌 Logo 与专属短链",
          "优先技术支持",
          "团队角色与多级权限管理",
        ],
      },
    ],
    faqTitle: "常见问题解答 (FAQ)",
    faqs: [
      {
        q: "这套房地产 CRM 系统包含哪些核心模块？",
        a: "本系统专为房地产经纪人和经纪行设计，集成了客户与线索管理 (CRM)、房源库管理、交易看板、佣金核算审批、文档签署归档、日程预约以及多语言界面。",
      },
      {
        q: "有免费版本可以使用吗？",
        a: "有的。Core 基础版永久免费，包含最多 5 套活跃房源、50 位客户档案及基础报表功能，无需绑定信用卡即可注册使用。",
      },
      {
        q: "如何切换中文或其他语言界面？",
        a: "您可以在页面顶部导航栏右侧（以及登录/注册页右上角）随时点击语言切换按钮，在简体中文、繁體中文、English 和 Español 之间即时切换。",
      },
      {
        q: "支持把现有的客户和房源表格导入进来吗？",
        a: "支持！在「客户管理」和「房源管理」页面均提供 CSV 批量导入功能，支持下载标准模板、导入前预览前 5 行数据，并可选择跳过或更新重复记录。",
      },
      {
        q: "可以邀请团队成员并设置不同权限吗？",
        a: "可以。公司管理员 (Firm Admin) 可在设置中通过邮件邀请经理 (Manager)、经纪人 (Agent) 等成员，系统严格执行多租户与角色数据隔离。",
      },
    ],
    cta: {
      title: "准备好提升团队成交效率了吗？",
      subtitle: "立即开启数字化房产经纪管理，免费注册或直接使用演示账号登录体验。",
      button: "免费创建账号 →",
    },
    footer: {
      tagline: "房地产经纪 CRM 管理平台",
      rights: "保留所有权利。",
    },
  },
  "zh-TW": {
    nav: {
      browseListings: "瀏覽公開房源",
      dashboard: "進入工作台 →",
      signIn: "登入系統",
      getStarted: "免費註冊",
    },
    hero: {
      badge: "專為現代房地產經紀公司與團隊打造",
      titleLine1: "新一代智慧化",
      titleHighlight: "房地產經紀 CRM 系統",
      subtitle:
        "一站式管理客戶線索、房源圖庫、交易管道與佣金分成。支援多語言切換、線索自動分配與 CSV 批次匯入，助您高效成交。",
      ctaPrimary: "免費開始使用 → 無需信用卡",
      ctaDashboard: "進入 CRM 工作台 →",
      ctaBrowse: "瀏覽公開房源",
      note: "提供永久免費版 · 無需綁定信用卡 · 支援 4 種語言（繁 / 簡 / EN / ES）",
    },
    featuresTitle: "現代房產經紀所需的一切功能",
    featuresSubtitle: "從首條線索捕獲到佣金結算發放 —— 無需在多個表格和工具之間來回切換。",
    features: [
      {
        icon: "👥",
        title: "客戶管理與線索分配",
        desc: "全程追蹤每位客戶從初次接觸到成交的跟進時間軸，支援按輪詢或規則自動分配新線索。",
      },
      {
        icon: "🏠",
        title: "房源與公開展示頁",
        desc: "支援本機多圖上傳、主圖排序、CSV 批次匯入房源，並可自訂公司專屬公開房源短網址與品牌色。",
      },
      {
        icon: "📊",
        title: "視覺化交易看板",
        desc: "拖曳式交易漏斗看板：報價審核 → 合約簽署 → 待交割 → 成功結案，自動產生交割清單任務。",
      },
      {
        icon: "💰",
        title: "佣金計算與審批",
        desc: "自動核算總佣金、公司抽成與經紀人淨收入，支援線上發起提領申請、主管審批及年度業績排行。",
      },
      {
        icon: "✨",
        title: "AI 行銷助手",
        desc: "數秒內產生多語系房源文案、社群媒體貼文與客戶開發郵件，支援多種行文風格切換。",
      },
      {
        icon: "📅",
        title: "帶看預約與郵件提醒",
        desc: "輕鬆安排看房、驗房與會議日程，支援新線索、預約前 24 小時及逾期任務的自動郵件提醒。",
      },
    ],
    pricingTitle: "簡單透明的訂閱方案",
    pricingSubtitle: "免費起步，隨團隊規模靈活升級。",
    plans: [
      {
        name: "Core 基礎版",
        price: "免費",
        sub: "永久有效",
        highlight: false,
        cta: "免費註冊",
        features: ["最多 5 套在售房源", "CRM 最多 50 位客戶", "基礎業績報表", "AI 房源描述產生"],
      },
      {
        name: "Pro 專業版",
        price: "$49",
        sub: "每月",
        highlight: true,
        cta: "立即開始",
        features: [
          "無限房源數量",
          "無限客戶與 CSV 批次匯入",
          "佣金分成瀑布流核算",
          "線索自動分配規則",
          "完整數據分析報表",
        ],
      },
      {
        name: "Elite 旗艦版",
        price: "$99",
        sub: "每月",
        highlight: false,
        cta: "立即開始",
        features: [
          "包含 Pro 版全部功能",
          "未來營收預測模型",
          "自訂品牌 Logo 與專屬短網址",
          "優先技術支援",
          "團隊角色與多級權限管理",
        ],
      },
    ],
    faqTitle: "常見問題解答 (FAQ)",
    faqs: [
      {
        q: "這套房地產 CRM 系統包含哪些核心模組？",
        a: "本系統專為房地產經紀人和經紀行設計，整合了客戶與線索管理 (CRM)、房源庫管理、交易看板、佣金核算審批、文件簽署歸檔、日程預約以及多語言介面。",
      },
      {
        q: "有免費版本可以使用嗎？",
        a: "有的。Core 基礎版永久免費，包含最多 5 套活躍房源、50 位客戶檔案及基礎報表功能，無需綁定信用卡即可註冊使用。",
      },
      {
        q: "如何切換中文或其他語言介面？",
        a: "您可以在頁面頂部導覽列右側（以及登入/註冊頁右上角）隨時點擊語言切換按鈕，在繁體中文、简体中文、English 和 Español 之間即時切換。",
      },
      {
        q: "支援把現有的客戶和房源表格匯入進來嗎？",
        a: "支援！在「客戶管理」和「房源管理」頁面均提供 CSV 批次匯入功能，支援下載標準範本、匯入前預覽前 5 列資料，並可選擇略過或更新重複記錄。",
      },
      {
        q: "可以邀請團隊成員並設定不同權限嗎？",
        a: "可以。公司管理員 (Firm Admin) 可在設定中透過郵件邀請經理 (Manager)、經紀人 (Agent) 等成員，系統嚴格執行多租戶與角色資料隔離。",
      },
    ],
    cta: {
      title: "準備好提升團隊成交效率了嗎？",
      subtitle: "立即開啟數位化房產經紀管理，免費註冊或直接使用展示帳號登入體驗。",
      button: "免費建立帳號 →",
    },
    footer: {
      tagline: "房地產經紀 CRM 管理平台",
      rights: "保留所有權利。",
    },
  },
  es: {
    nav: {
      browseListings: "Ver propiedades",
      dashboard: "Ir al panel →",
      signIn: "Ingresar",
      getStarted: "Crear cuenta",
    },
    hero: {
      badge: "Pensado para inmobiliarias de Uruguay",
      titleLine1: "Tu inmobiliaria,",
      titleHighlight: "en un solo lugar",
      subtitle:
        "Sitio web con mapa y filtros instantáneos, interesados, visitas, documentos y alquileres. Cada inmobiliaria con su dominio, su sitio y sus datos.",
      ctaPrimary: "Crear cuenta →",
      ctaDashboard: "Entrar al panel →",
      ctaBrowse: "Ver propiedades",
      note: "En español · Precios en US$ y $ · Campos en hectáreas",
    },
    featuresTitle: "Todo lo que necesita una inmobiliaria",
    featuresSubtitle:
      "Desde la primera consulta hasta el contrato firmado, sin cambiar de pestaña.",
    features: [
      {
        icon: "👥",
        title: "Interesados y clientes",
        desc: "Seguí a cada interesado desde la primera consulta, con reparto automático entre agentes e historial de actividad.",
      },
      {
        icon: "🏠",
        title: "Propiedades",
        desc: "Subí fotos, publicá en tu sitio con tu propio enlace e importá tu cartera desde un CSV.",
      },
      {
        icon: "🗺️",
        title: "Sitio web con mapa",
        desc: "Filtros instantáneos, mapa con zonas aproximadas y botón de WhatsApp en cada propiedad.",
      },
      {
        icon: "🔑",
        title: "Alquileres",
        desc: "Contratos, cobros mensuales, vencimientos y liquidaciones a propietarios, con totales separados por moneda.",
      },
      {
        icon: "📄",
        title: "Documentos",
        desc: "Contratos y documentos de identidad privados, con enlaces de acceso que vencen.",
      },
      {
        icon: "📅",
        title: "Visitas y agenda",
        desc: "Agendá visitas con recordatorios automáticos por email.",
      },
    ],
    pricingTitle: "Precios Simples y Transparentes",
    pricingSubtitle: "Empiece gratis. Actualice a medida que crezca su equipo.",
    plans: [
      {
        name: "Core",
        price: "Gratis",
        sub: "para siempre",
        highlight: false,
        cta: "Comenzar Gratis",
        features: ["5 Propiedades Activas", "CRM — hasta 50 clientes", "Informes Básicos", "Descripciones con IA"],
      },
      {
        name: "Pro",
        price: "$49",
        sub: "por mes",
        highlight: true,
        cta: "Comenzar",
        features: [
          "Propiedades Ilimitadas",
          "Clientes Ilimitados e Importación CSV",
          "Cálculo de Comisiones",
          "Asignación Automática de Leads",
          "Analítica Completa",
        ],
      },
      {
        name: "Elite",
        price: "$99",
        sub: "por mes",
        highlight: false,
        cta: "Comenzar",
        features: [
          "Todo lo de Pro",
          "Proyecciones de Ingresos",
          "Marca y Enlace Público Personalizado",
          "Soporte Prioritario",
          "Roles y Permisos de Equipo",
        ],
      },
    ],
    faqTitle: "Preguntas frecuentes",
    faqs: [
      {
        q: "¿Qué es esta plataforma?",
        a: "Es un sistema en la nube para inmobiliarias: sitio web propio, CRM de interesados, visitas, documentos y gestión de alquileres, con los datos de cada inmobiliaria separados.",
      },
      {
        q: "¿Puedo traer mis propiedades desde inmobiliariaya?",
        a: "Sí. Tenemos un migrador que importa las propiedades públicas, con fotos y datos, y deja un informe para revisar.",
      },
      {
        q: "¿Puedo cambiar el idioma?",
        a: "Sí, desde el selector de idioma de la barra superior.",
      },
    ],
    cta: {
      title: "¿Querés probarla con tu inmobiliaria?",
      subtitle: "Creá tu cuenta y empezá a cargar tus propiedades.",
      button: "Crear cuenta →",
    },
    footer: {
      tagline: "Plataforma para inmobiliarias de Uruguay",
      rights: "Todos los derechos reservados.",
    },
  },
};

export default function LandingPageClient() {
  const { language, setLanguage, t } = useI18n();
  const { theme, setTheme } = useTheme();
  const { token } = useAuth();
  // Plans and prices only when the platform charges through Stripe (billing module); otherwise billing happens outside
  const installModules = useInstallationModules();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("annual");
  const [isLangOpen, setIsLangOpen] = useState(false);
  const [isThemeOpen, setIsThemeOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  const copy = COPY[language] || COPY.en;
  const U = t.upgrade;
  const tn = (t as any).settings?.appearance?.themeNames ?? {};
  const themes: { id: ThemeName; label: string; color: string }[] = [
    { id: "luxury", label: tn.luxury || "Luxury", color: "#B8977E" },
    { id: "modern", label: tn.modern || "Modern", color: "#4F7DF3" },
    { id: "youth", label: tn.youth || "Youth", color: "#7C5CFC" },
    { id: "chinese", label: tn.chinese || "Chinese", color: "#C43B38" },
    { id: "cyberpunk", label: tn.cyberpunk || "Cyberpunk", color: "#00F0FF" },
  ];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setIsLangOpen(false);
      if (themeRef.current && !themeRef.current.contains(e.target as Node)) setIsThemeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Nav ── */}
      <header className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-surface border border-border flex items-center justify-center font-serif text-sm font-bold text-primary">
              RE
            </div>
            <span className="font-bold text-primary tracking-tight">Real Estate CRM</span>
          </div>

          <nav className="flex items-center gap-2.5 sm:gap-4">
            {FEATURED_SLUG && (
              <Link
                href={LISTINGS_HREF}
                className="text-sm text-foreground/60 hover:text-primary transition-colors hidden md:block"
              >
                {copy.nav.browseListings}
              </Link>
            )}

            {/* Theme switcher */}
            <div className="relative" ref={themeRef}>
              <button
                onClick={() => setIsThemeOpen((v) => !v)}
                title="Switch Theme"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-xs font-medium text-foreground transition-colors"
              >
                <span
                  className="w-3 h-3 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: themes.find((th) => th.id === theme)?.color }}
                />
                <svg
                  className={`w-3 h-3 text-foreground/40 transition-transform ${isThemeOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isThemeOpen && (
                <div className="absolute top-full right-0 mt-2 w-44 bg-surface rounded-xl shadow-lg border border-border overflow-hidden z-50">
                  {themes.map((th) => (
                    <button
                      key={th.id}
                      onClick={() => {
                        setTheme(th.id);
                        setIsThemeOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors flex items-center gap-2.5 ${
                        theme === th.id
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-foreground/70 hover:bg-surface-hover"
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0 ring-1 ring-border"
                        style={{ backgroundColor: th.color }}
                      />
                      {th.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Language switcher */}
            <div className="relative" ref={langRef}>
              <button
                onClick={() => setIsLangOpen((v) => !v)}
                title="Switch Language / 切换语言"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-hover text-xs font-medium text-foreground transition-colors"
              >
                <svg className="w-3.5 h-3.5 text-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                  />
                </svg>
                <span>
                  {language === "zh-CN"
                    ? "简体中文"
                    : language === "zh-TW"
                    ? "繁體中文"
                    : language === "es"
                    ? "ES"
                    : "EN"}
                </span>
                <svg
                  className={`w-3 h-3 text-foreground/40 transition-transform ${isLangOpen ? "rotate-180" : ""}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isLangOpen && (
                <div className="absolute top-full right-0 mt-2 w-40 bg-surface rounded-xl shadow-lg border border-border overflow-hidden z-50">
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLanguage(l.code as any);
                        setIsLangOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors ${
                        language === l.code
                          ? "bg-primary/10 text-primary font-semibold"
                          : "text-foreground/70 hover:bg-surface-hover"
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {token ? (
              <Link
                href="/dashboard"
                className="px-4 py-1.5 bg-primary text-background text-sm font-semibold rounded-lg hover:opacity-90 transition"
              >
                {copy.nav.dashboard}
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm text-foreground/70 hover:text-primary transition-colors font-medium"
                >
                  {copy.nav.signIn}
                </Link>
                <Link
                  href="/signup"
                  className="px-3.5 py-1.5 bg-primary text-background text-sm font-semibold rounded-lg hover:opacity-90 transition hidden sm:inline-block"
                >
                  {copy.nav.getStarted}
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-24 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/20 rounded-full text-xs text-primary font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          {copy.hero.badge}
        </div>
        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
          {copy.hero.titleLine1}
          <br />
          <span className="text-primary">{copy.hero.titleHighlight}</span>
        </h1>
        <p className="text-lg text-foreground/60 max-w-2xl mx-auto mb-10">{copy.hero.subtitle}</p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          {token ? (
            <Link
              href="/dashboard"
              className="px-8 py-3.5 bg-primary text-background font-semibold rounded-xl hover:opacity-90 transition text-base"
            >
              {copy.hero.ctaDashboard}
            </Link>
          ) : (
            <>
              <Link
                href="/signup"
                className="px-8 py-3.5 bg-primary text-background font-semibold rounded-xl hover:opacity-90 transition text-base"
              >
                {copy.hero.ctaPrimary}
              </Link>
              <Link
                href="/login"
                className="px-8 py-3.5 bg-surface border border-border text-foreground font-semibold rounded-xl hover:bg-background transition text-base"
              >
                {copy.nav.signIn}
              </Link>
            </>
          )}
          {FEATURED_SLUG && (
            <Link
              href={LISTINGS_HREF}
              className="px-8 py-3.5 bg-surface border border-border text-foreground font-semibold rounded-xl hover:bg-background transition text-base"
            >
              {copy.hero.ctaBrowse}
            </Link>
          )}
        </div>
        <p className="text-xs text-foreground/40 mt-4">{copy.hero.note}</p>
      </section>

      {/* ── Features ── */}
      <section className="bg-surface border-y border-border py-20" id="features">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-center text-foreground mb-3">{copy.featuresTitle}</h2>
          <p className="text-center text-foreground/50 mb-14 max-w-xl mx-auto">{copy.featuresSubtitle}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {copy.features.map((f) => (
              <div
                key={f.title}
                className="bg-background border border-border rounded-xl p-6 hover:border-primary/40 transition-colors"
              >
                <div className="text-3xl mb-4">{f.icon}</div>
                <h3 className="font-bold text-foreground mb-2">{f.title}</h3>
                <p className="text-foreground/50 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing (Synced with t.upgrade: Core $0 / Pro $39 mo, $390 yr / Elite $79 mo, $790 yr) ── */}
      {installModules?.billing && <section className="max-w-6xl mx-auto px-6 py-20" id="pricing">
        <h2 className="text-2xl sm:text-3xl font-bold text-center text-foreground mb-3">{U.title}</h2>
        <p className="text-center text-foreground/50 mb-8 max-w-2xl mx-auto">{U.subtitle}</p>

        {/* Monthly / Annual Billing Toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex items-center gap-2 bg-surface p-1 rounded-full border border-border">
            <button
              onClick={() => setBillingCycle("monthly")}
              className={`px-5 py-2 rounded-full text-sm font-sans uppercase tracking-widest transition-all ${
                billingCycle === "monthly"
                  ? "bg-background shadow text-foreground"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              {U.monthly}
            </button>
            <button
              onClick={() => setBillingCycle("annual")}
              className={`px-5 py-2 rounded-full text-sm font-sans uppercase tracking-widest transition-all flex items-center gap-2 ${
                billingCycle === "annual"
                  ? "bg-background shadow text-foreground"
                  : "text-foreground/50 hover:text-foreground"
              }`}
            >
              {U.annual}
              <span className="bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full font-medium">
                {U.save}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              key: "core",
              name: U.core.name,
              price: U.core.price,
              period: "",
              desc: U.core.desc,
              features: U.core.features,
              highlight: false,
              cta: copy.nav.getStarted,
              href: token ? "/upgrade" : "/signup",
            },
            {
              key: "pro",
              name: U.pro.name,
              price: billingCycle === "annual" ? U.pro.priceA : U.pro.priceM,
              period: billingCycle === "annual" ? "/yr" : "/mo",
              desc: U.pro.desc,
              features: U.pro.features,
              highlight: true,
              cta: U.pro.btn,
              href: token ? "/upgrade" : "/signup",
            },
            {
              key: "elite",
              name: U.elite.name,
              price: billingCycle === "annual" ? U.elite.priceA : U.elite.priceM,
              period: billingCycle === "annual" ? "/yr" : "/mo",
              desc: U.elite.desc,
              features: U.elite.features,
              highlight: false,
              cta: U.elite.btn,
              href: token ? "/upgrade" : "/signup",
            },
          ].map((plan) => (
            <div
              key={plan.key}
              className={`rounded-xl p-7 border flex flex-col ${
                plan.highlight
                  ? "bg-primary border-primary text-background shadow-xl scale-105"
                  : "bg-surface border-border text-foreground"
              }`}
            >
              <div className="text-sm font-semibold uppercase tracking-widest mb-1 opacity-70">{plan.name}</div>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-4xl font-bold">{plan.price}</span>
                {plan.period && (
                  <span className={`text-sm font-medium ${plan.highlight ? "opacity-75" : "text-foreground/40"}`}>
                    {plan.period}
                  </span>
                )}
              </div>
              <p className={`text-xs mb-6 min-h-[32px] leading-relaxed ${plan.highlight ? "opacity-85" : "text-foreground/50"}`}>
                {plan.desc}
              </p>
              <ul className="space-y-2.5 flex-1 mb-7">
                {plan.features.map((f: string) => (
                  <li key={f} className="flex items-center gap-2 text-sm">
                    <span className={plan.highlight ? "text-background/80" : "text-primary"}>✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={plan.href}
                className={`w-full py-2.5 rounded-lg text-sm font-semibold text-center transition ${
                  plan.highlight
                    ? "bg-background text-primary hover:opacity-90"
                    : "bg-primary text-background hover:opacity-90"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>}

      {/* ── FAQ ── */}
      <section className="bg-surface border-t border-border py-20" id="faq">
        <div className="max-w-3xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-center text-foreground mb-12">{copy.faqTitle}</h2>
          <div className="space-y-6">
            {copy.faqs.map(({ q, a }) => (
              <details key={q} className="border border-border rounded-xl p-5 group">
                <summary className="font-semibold text-foreground cursor-pointer list-none flex justify-between items-center">
                  {q}
                  <span className="text-primary text-lg group-open:rotate-45 transition-transform inline-block">
                    +
                  </span>
                </summary>
                <p className="text-foreground/60 text-sm mt-3 leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="max-w-6xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold text-foreground mb-4">{copy.cta.title}</h2>
        <p className="text-foreground/50 mb-8">{copy.cta.subtitle}</p>
        <Link
          href="/signup"
          className="inline-block px-10 py-4 bg-primary text-background font-semibold text-base rounded-xl hover:opacity-90 transition"
        >
          {copy.cta.button}
        </Link>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border bg-surface py-10">
        <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-foreground/40">
          <div className="flex items-center gap-2">
            <span className="font-bold text-primary">Real Estate CRM</span>
            <span>· {copy.footer.tagline}</span>
          </div>
          <div className="flex gap-6">
            {FEATURED_SLUG && (
              <Link href={LISTINGS_HREF} className="hover:text-foreground transition-colors">
                {copy.nav.browseListings}
              </Link>
            )}
            <Link href="/login" className="hover:text-foreground transition-colors">
              {copy.nav.signIn}
            </Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">
              {copy.nav.getStarted}
            </Link>
          </div>
          <span>
            © {new Date().getFullYear()} Real Estate CRM. {copy.footer.rights}
          </span>
        </div>
      </footer>
    </div>
  );
}
