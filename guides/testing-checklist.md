# Pilot testing checklist

A short script for brokerage staff trying the CRM. Each step lists what should
happen; note anything that doesn't.

## 1. Account & team (firm admin)
- [ ] Sign up a brokerage, log in, open **Settings → Organization**, fill in details.
- [ ] Set **Commission defaults** (e.g. 3% rate, 30% firm split) and save.
- [ ] Invite an agent from **Settings → Team**; the agent accepts and logs in.
- [ ] In **Settings → Org Settings** (`1.4`), upload a **Company Logo** from device, set a **Brand Accent Color**, and change the **Custom Public URL Slug** — verify the old slug redirects to the new slug.
- [ ] In **Settings → Lead Routing** (`1.2`), create a Round-Robin rule and test it with the **Simulator (Dry-Run)**; in **Settings → Notifications** (`1.3`), save email alert preferences and verify they persist.

## 2. Clients (agent)
- [ ] **CRM → Add Client** with source and priority. Adding the same email again warns about a duplicate.
- [ ] Search by name, phone or email — results come from all pages, not just the first.
- [ ] Tick **Needs follow-up** — clients never contacted (or not in 14 days) appear.
- [ ] Open a client → **Log Activity** (call/email/text…) with a follow-up date →
      the timeline updates, "Last contact" shows today, a task appears in **Tasks**.
- [ ] **Edit Profile** → change priority/tags → saved.
- [ ] **CRM → Import CSV** (`3.3a`) → download the sample template, upload a CSV file, verify the 5-row preview, and import with **Skip existing records** or **Update existing records**.

## 3. Listings & website leads
- [ ] **Listings → Add property**, upload multiple photos directly from device (`1.1`), reorder them, and set a cover photo; also test **Listings → Import CSV** (`3.3a`).
- [ ] **Documents → Upload Document** (`1.1`), upload a private PDF contract from device, click **View**, and verify it opens via a 10-minute signed preview URL.
- [ ] Click **Public page** — the listing opens without logging in.
- [ ] **Settings → Org Settings** shows your brokerage's public listings link; it lists only your brokerage's homes.
- [ ] Submit the inquiry form from a private/incognito window →
      the agent gets a notification, a new **Hot** client with source *Website*, and an urgent call-back task.
- [ ] Click **QR** on the listing card and open the copied link — the form becomes an open-house sign-in.

## 4. Offers, deals, commission
- [ ] **Transactions → Add Offer** for a client on a listing.
- [ ] **Counter** (enter an amount), then **Accept** → a deal is created, the listing shows *In Contract*,
      and closing-checklist tasks appear in **Tasks**.
- [ ] In **Pipeline**, move the deal to **Closed** → the listing shows *Sold* and a commission appears in **Finance**.
- [ ] Agent clicks **Request payout**; a manager approves it in **Finance** → agent is notified.

## 5. Appointments & dashboard
- [ ] Schedule a showing for later today with a location — the time shown matches what you entered.
- [ ] Confirm / complete / cancel it from the list.
- [ ] **Dashboard** shows today's appointments, overdue tasks and leads needing follow-up.

## 6. AI assistant
- [ ] **Marketing** shows the AI assistant marked **In development** with its buttons disabled (not part of this pilot).

## 7. Permissions
- [ ] An agent only sees their own clients and deals; a manager sees the whole brokerage.
- [ ] Two separate brokerages never see each other's clients, deals or documents.

## 8. Security settings / 安全设置
- [ ] **Settings → Security** (as a firm admin): change the minimum password length to 12 and require a special character, save, then invite a teammate — a short or plain password on the invitation page is refused with a clear message.
      *设置 → 安全（公司管理员）：把最短密码长度改成 12 并要求特殊字符，保存后邀请一位同事——邀请页里过短或没有特殊字符的密码会被拒绝并给出清楚的提示。*
- [ ] Set the session timeout to 15 minutes, sign in, wait 16 minutes and click anything — you are sent back to sign in. Set it back to 24 hours afterwards.
      *把会话时长设成 15 分钟，登录后等 16 分钟再点任何地方——会被送回登录页。测完请改回 24 小时。*
- [ ] **Send Reset Link** emails a real reset link; after resetting the password, a session that was open on another device is signed out (with “sign out on password change” on).
      *“发送重置链接”会发出真实的重置邮件；重设密码后，另一台设备上已打开的会话会被退出（开启“改密码后退出”时）。*
- [ ] A manager or agent sees the security rules but cannot save changes.
      *经理和经纪人能看到安全规则，但不能保存修改。*
- [ ] Two-factor authentication, login alerts and the IP whitelist show **Coming soon** and do nothing yet.
      *双因素认证、登录提醒和 IP 白名单显示“即将推出”，目前不起作用。*

## 9. Settings: CRM, Properties, Finance, Appointments, Documents / 设置：CRM、房源、财务、预约、文档
- [ ] **Settings → CRM** (firm admin): make *Email* a required field, save, then add a client without an email — it is refused with a clear message; the add form shows a red asterisk on Email. Set the client limit to 1 and try adding a second open client as an agent — refused.
      *设置 → CRM（公司管理员）：把“邮箱”设为必填并保存，再添加没有邮箱的客户——会被拒绝并给出提示，表单里邮箱带红色星号。把客户上限设为 1，用经纪人账号再加第二个在跟进的客户——会被拒绝。*
- [ ] Turn on “agents can see all clients”: an agent sees everyone's clients but can only edit their own.
      *打开“经纪人可查看全部客户”：经纪人能看到所有客户，但只能修改自己的。*
- [ ] **Settings → Properties**: require 3 photos before Active. A new listing starts as *Coming soon*; upload 3 photos, then **Set Active** works. Set a photo limit of 3 — a fourth photo is refused. Set “managers only” — an agent cannot add a listing.
      *设置 → 房源：设为“上架前至少 3 张照片”。新房源先是“即将上市”；传满 3 张后“设为在售”可用。把每个房源照片上限设为 3，第四张会被拒绝。设为“仅经理可新建”，经纪人无法添加房源。*
- [ ] **Settings → Appointments**: turn on “prevent double booking” and book two overlapping showings — a confirmation asks whether to book anyway. Turn off weekends — the week view shows Monday to Friday. Set workday hours — the week and day views follow them.
      *设置 → 预约：打开“禁止重复预约”，预约两个时间重叠的看房——会弹出确认是否仍要预约。关闭周末后，周视图只显示周一到周五。设置工作时间后，周视图和日视图按此显示。*
- [ ] **Settings → Documents**: allow PDF only and 1 MB. In **Documents**, a Word file or a bigger file is refused with a clear message; the upload box lists the rules.
      *设置 → 文档：只允许 PDF，上限 1 MB。在“文档”里上传 Word 文件或超过 1 MB 的文件会被拒绝并给出提示；上传框会列出规则。*
- [ ] **Settings → Finance**: turn off “agents see colleagues' gross” — an agent's leaderboard shows “—” for others, while a manager still sees all amounts. Change the fiscal-year start month — year-to-date figures change.
      *设置 → 财务：关闭“经纪人可看同事佣金总额”——经纪人的排行榜里他人显示“—”，经理仍可见全部金额。修改财年起始月份，“年初至今”数字随之变化。*
- [ ] Personal preferences (any user) — default client type/stage, compact list, hide budget, default listing status, default appointment length, auto-confirm, hide leaderboard / dashboard income — apply on the matching pages and only for that user.
      *个人偏好（任何用户）：默认客户类型和阶段、紧凑列表、隐藏预算、新房源默认状态、预约默认时长、自动确认、隐藏排行榜和仪表盘收入——在对应页面生效，且只影响本人。*
- [ ] Marketing, Access Control and Integrations still show **Coming soon**. A manager or agent sees the company rules but cannot save them.
      *营销、访问控制、集成仍显示“即将推出”。经理和经纪人能看到公司规则，但不能保存。*

## 10. Módulos (fork Uruguay)

- [ ] **Ajustes > Módulos** (administrador de la inmobiliaria): aparecen los 17 módulos con descripción, estado
  y de qué dependen. Un agente ve la lista pero no puede cambiar nada.
- [ ] Apagar **Visitas y agenda**: desaparece "Citas" del menú y la tarjeta "Citas de hoy" del panel; entrar a
  `/appointments` muestra "Esta sección no está disponible". Encenderlo de nuevo: vuelven las citas que había.
- [ ] Apagar **Ofertas y operaciones de venta**: desaparecen Pipeline, Operaciones, Reportes y también Finanzas
  (Comisiones depende de este módulo y lo indica en la lista).
- [ ] Apagar **Sitio público**: la página pública de propiedades de la inmobiliaria da error y el formulario de
  consulta no se puede enviar. Otra inmobiliaria no se ve afectada.
- [ ] Apagar **Reparto de consultas**: desaparece "Asignación de Leads" en Ajustes; una consulta desde el sitio le
  llega al agente de la propiedad.
- [ ] "Usar valor de la plataforma" devuelve un módulo a su valor por defecto. Cada cambio queda en la auditoría.
- [ ] Con **Regalos** y **Referidos** apagados, "Servicios" no aparece en el menú; con uno solo encendido, la
  página muestra solo esa tarjeta.

## 11. Localización Uruguay (fork Uruguay)

- [ ] Una inmobiliaria nueva arranca en español; en Ajustes > Datos de la inmobiliaria la zona horaria es
  America/Montevideo y la moneda US$. El selector de idioma muestra Español e Inglés.
- [ ] Ninguna pantalla activa (panel, CRM, propiedades, visitas, tareas, documentos, ajustes, sitio público,
  ingreso y registro) muestra textos en inglés.
- [ ] Cargar un cliente con teléfono «099 123 456»: en la ficha se ve igual, y cargar otro con «+598 99 123 456»
  avisa que está duplicado.
- [ ] Cargar una propiedad en «termas del dayman» y otra en «Termas del Daymán»: las dos quedan en la misma
  ciudad, escrita «Termas del Daymán». El departamento se elige de la lista.
- [ ] El tipo de propiedad ofrece el catálogo de Uruguay; en Ajustes > Propiedades se puede cambiar.
- [ ] Una consulta desde el sitio llega como «Nueva consulta (Sitio web)» y crea la tarea «Llamar a…».
- [ ] Los números se ven con punto de miles y coma decimal; las horas de los avisos, en hora de Montevideo.

## 12. Propiedades Uruguay (fork Uruguay)

- [ ] Cargar un campo en hectáreas, sin dirección (solo la zona) y con precio «Consultar»: se guarda y la ficha
  pública muestra «Consultar».
- [ ] Cargar una casa en venta en US$ y en alquiler en $ a la vez: la tarjeta del panel y el sitio muestran las
  dos («US$ 290.000» y «$ 25.000 por mes»).
- [ ] Editar una propiedad (botón «Editar» en la tarjeta), quitar el alquiler y guardar: queda solo la venta.
- [ ] En Ubicación, marcar el pin en el mapa; elegir «Aproximada»: el sitio público no muestra el punto exacto.
  Con «Oculta», no muestra ubicación. Desmarcar «Mostrar en el sitio web»: la ficha pública deja de verse.
- [ ] Subir una foto grande: se ve bien en el sitio y carga rápido (hay versiones WebP más chicas).
- [ ] En Ajustes > Propiedades, marcar «Dormitorios» como obligatorio: una casa sin dormitorios no se guarda,
  un local comercial sí.
- [ ] Importar un CSV con una fila sin ciudad: esa fila se informa como error y las demás se importan.
- [ ] Las propiedades que ya existían siguen mostrando su precio.

## 13. Dominio propio y servidor (fork Uruguay)

- [ ] Ajustes > Datos de la inmobiliaria > Dominio propio: cargar `castroymeirelles.com.uy`; se guarda en
  minúscula y sin `https://` ni `www.`. Otra inmobiliaria no puede cargar el mismo dominio.
- [ ] Con el DNS apuntando al servidor, `https://dominio` y `https://www.dominio` abren con candado; un dominio
  no cargado no abre (sin certificado).
- [ ] Desde el dominio de la inmobiliaria no se puede usar la API del panel (por ejemplo `/api/clients` da 404).
- [ ] Un release nuevo (tag) aparece en `https://app.PLATFORM_DOMAIN/api/health` con su versión.
- [ ] Prueba mensual de restauración según `guides/restore.md`, anotada en su tabla.

## 14. Sitio web de la inmobiliaria (fork Uruguay)

- [ ] Abrir el sitio (`https://{slug}.PLATFORM_DOMAIN`, el dominio propio o, sin dominio, `/sites/{slug}`):
  portada con buscador, destacadas y datos de contacto al pie.
- [ ] `/propiedades`: cada filtro cambia la lista al instante y los números entre paréntesis se actualizan; la
  dirección cambia (copiarla en otra pestaña abre los mismos resultados) y el botón Atrás deshace el filtro.
- [ ] Buscar «dayman» encuentra «Termas del Daymán». El precio se filtra en la moneda elegida (US$ o $).
- [ ] «Lista y mapa»: los pins coinciden con la lista; acercar el mapa y tocar «Buscar en esta zona».
- [ ] Ficha: galería (flechas, pantalla completa), datos, mapa (círculo si la ubicación es aproximada; sin mapa
  si está oculta), WhatsApp con «Hola, me interesa la propiedad COD. …» y llamada.
- [ ] Formulario de consulta: sin marcar la casilla de privacidad no se envía; enviado, aparece el interesado con
  origen «Sitio web», tarea y aviso al agente.
- [ ] Favoritos: el corazón guarda la propiedad y aparece en `/favoritos` (en el mismo navegador).
- [ ] Ajustes > Sitio web: cambiar diseño de portada, tipografía, páginas y política de privacidad; se ve en el
  sitio en menos de un minuto.
- [ ] `/public-listings?b={slug}` lleva al sitio nuevo. Con el módulo «Sitio público» apagado, el sitio no abre.
- [ ] Un dominio de demostración no se indexa (`/robots.txt` con `Disallow: /`).

Report problems with: the page, what you clicked, what you expected, what happened, and a screenshot.
