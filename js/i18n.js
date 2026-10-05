/**
 * i18n.js — English / বাংলা / 中文 UI strings + locale & currency handling.
 *
 * SP.t('key') returns the active-locale string, falling back to English.
 * Language switch applies app-wide (nav, statuses, buttons, titles) and
 * suggests the matching currency (BN→BDT, ZH→CNY, EN→USD) — the user can
 * still override currency independently in Settings.
 */
window.SP = window.SP || {};

SP.i18n = (() => {

  const DICT = {
    /* ── navigation / modules ─────────────────────────────────── */
    'nav.dashboard': ['Dashboard', 'ড্যাশবোর্ড', '仪表盘'],
    'nav.packing': ['Packing', 'প্যাকিং', '打包'],
    'nav.qc': ['QC Approval', 'কিউসি অনুমোদন', '质检批准'],
    'nav.delivery': ['Delivery', 'ডেলিভারি', '配送'],
    'nav.orders': ['Orders', 'অর্ডার', '订单'],
    'nav.proofs': ['Photo Proofs', 'ফটো প্রমাণ', '照片凭证'],
    'nav.users': ['Users & Assignment', 'ব্যবহারকারী ও অ্যাসাইনমেন্ট', '用户与分配'],
    'nav.audit': ['Audit Log', 'অডিট লগ', '审计日志'],
    'nav.settings': ['Settings', 'সেটিংস', '设置'],
    'nav.group.work': ['Work', 'কাজ', '工作'],
    'nav.group.track': ['Track', 'ট্র্যাক', '跟踪'],
    'nav.group.admin': ['Administration', 'প্রশাসন', '管理'],
    'tab.more': ['More', 'আরও', '更多'],

    /* ── statuses ─────────────────────────────────────────────── */
    'status.new': ['New', 'নতুন', '新建'],
    'status.assigned': ['Assigned to packer', 'প্যাকারকে দেওয়া হয়েছে', '已分配给打包员'],
    'status.packing': ['Packing', 'প্যাকিং চলছে', '打包中'],
    'status.packed': ['Packed — awaiting QC', 'প্যাক হয়েছে — কিউসি বাকি', '已打包 — 待质检'],
    'status.qc_approved': ['QC approved', 'কিউসি অনুমোদিত', '质检已通过'],
    'status.qc_rejected': ['QC rejected — rework', 'কিউসি বাতিল — পুনঃকাজ', '质检被拒 — 返工'],
    'status.out_for_delivery': ['Out for delivery', 'ডেলিভারিতে বের হয়েছে', '配送中'],
    'status.delivered': ['Delivered', 'ডেলিভার হয়েছে', '已送达'],
    'status.failed': ['Delivery failed', 'ডেলিভারি ব্যর্থ', '配送失败'],
    'status.returned': ['Returned', 'ফেরত এসেছে', '已退回'],
    'status.cancelled': ['Cancelled', 'বাতিল', '已取消'],

    /* ── roles ────────────────────────────────────────────────── */
    'role.packer': ['Packing Staff', 'প্যাকিং স্টাফ', '打包员'],
    'role.approver': ['QC Approver', 'কিউসি অনুমোদক', '质检批准员'],
    'role.driver': ['Driver', 'ড্রাইভার', '司机'],
    'role.delivery': ['Delivery Staff', 'ডেলিভারি স্টাফ', '配送员'],
    'role.supervisor': ['Supervisor', 'সুপারভাইজার', '主管'],
    'role.admin': ['Administrator', 'অ্যাডমিনিস্ট্রেটর', '管理员'],

    /* ── common actions ───────────────────────────────────────── */
    'act.new_order': ['New S/O', 'নতুন অর্ডার', '新建订单'],
    'act.new_user': ['New user', 'নতুন ব্যবহারকারী', '新建用户'],
    'act.scan': ['Scan', 'স্ক্যান', '扫描'],
    'act.scan_order': ['Scan order', 'অর্ডার স্ক্যান', '扫描订单'],
    'act.scan_item': ['Scan item', 'আইটেম স্ক্যান', '扫描商品'],
    'act.scan_parcel': ['Scan parcel', 'পার্সেল স্ক্যান', '扫描包裹'],
    'act.claim': ['Claim', 'দাবি করুন', '领取'],
    'act.claim_review': ['Claim & review', 'দাবি করে যাচাই', '领取并审核'],
    'act.review': ['Review', 'যাচাই', '审核'],
    'act.rework': ['Rework', 'পুনঃকাজ', '返工'],
    'act.continue': ['Continue', 'চালিয়ে যান', '继续'],
    'act.assign': ['Assign', 'অ্যাসাইন', '分配'],
    'act.assign_packer': ['Assign packer', 'প্যাকার অ্যাসাইন', '分配打包员'],
    'act.assign_qc': ['Assign QC', 'কিউসি অ্যাসাইন', '分配质检员'],
    'act.assign_delivery': ['Assign delivery', 'ডেলিভারি অ্যাসাইন', '分配配送'],
    'act.dispatch': ['Dispatch', 'পাঠান', '发货'],
    'act.assign_dispatch': ['Assign & dispatch', 'অ্যাসাইন ও পাঠান', '分配并发货'],
    'act.delivered': ['Delivered — capture proof', 'ডেলিভার হয়েছে — প্রমাণ তুলুন', '已送达 — 拍摄凭证'],
    'act.failed': ['Failed', 'ব্যর্থ', '失败'],
    'act.retry': ['Retry delivery', 'আবার চেষ্টা', '重试配送'],
    'act.return': ['Return', 'ফেরত', '退回'],
    'act.map': ['Map', 'ম্যাপ', '地图'],
    'act.call': ['Call', 'কল', '拨打'],
    'act.print_slip': ['Print packing slip', 'প্যাকিং স্লিপ প্রিন্ট', '打印装箱单'],
    'act.cancel_order': ['Cancel order', 'অর্ডার বাতিল', '取消订单'],
    'act.export': ['Export', 'এক্সপোর্ট', '导出'],
    'act.approve_photo': ['Approve + photo', 'অনুমোদন + ফটো', '批准 + 拍照'],
    'act.reject': ['Reject', 'বাতিল', '拒绝'],
    'act.mark_packed': ['Mark packed & submit photo proof', 'প্যাক হয়েছে ও ফটো প্রমাণ দিন', '标记已打包并提交照片'],
    'act.my_run': ['My run', 'আমার রান', '我的行程'],
    'act.open': ['Open', 'খুলুন', '打开'],
    'act.resolve': ['Resolve', 'সমাধান', '处理'],
    'act.download': ['Download', 'ডাউনলোড', '下载'],
    'act.backup': ['Download backup', 'ব্যাকআপ ডাউনলোড', '下载备份'],
    'act.restore': ['Restore', 'রিস্টোর', '恢复'],
    'act.wipe': ['Wipe data', 'ডেটা মুছুন', '清除数据'],
    'act.purge_proofs': ['Purge old proofs', 'পুরনো প্রমাণ মুছুন', '清理旧凭证'],
    'act.change_password': ['Change password', 'পাসওয়ার্ড বদলান', '修改密码'],
    'act.set_pin': ['Set PIN', 'পিন সেট', '设置PIN'],
    'act.change_pin': ['Change PIN', 'পিন বদলান', '修改PIN'],
    'act.sign_out': ['Sign out', 'সাইন আউট', '退出登录'],
    'act.theme': ['Toggle theme', 'থিম বদলান', '切换主题'],
    'act.save': ['Save', 'সেভ', '保存'],
    'act.confirm': ['Confirm', 'নিশ্চিত', '确认'],
    'act.cancel': ['Cancel', 'বাতিল', '取消'],
    'act.close': ['Close', 'বন্ধ', '关闭'],
    'act.add_item': ['Add item', 'আইটেম যোগ', '添加商品'],
    'act.create': ['Create', 'তৈরি', '创建'],
    'act.edit': ['Edit', 'এডিট', '编辑'],
    'act.delete': ['Delete', 'ডিলিট', '删除'],
    'act.enable': ['Enable', 'চালু', '启用'],
    'act.disable': ['Disable', 'বন্ধ', '禁用'],
    'act.logout_all': ['Log out everywhere', 'সব ডিভাইস থেকে লগ আউট', '退出所有设备'],
    'act.mark_all_read': ['Mark all as read', 'সব পঠিত চিহ্নিত', '全部标为已读'],

    /* ── dashboard ────────────────────────────────────────────── */
    'dash.to_pack': ['To pack', 'প্যাক বাকি', '待打包'],
    'dash.qc_queue': ['QC queue', 'কিউসি সারি', '质检队列'],
    'dash.out_for_delivery': ['Out for delivery', 'ডেলিভারিতে আছে', '配送中'],
    'dash.delivered_today': ['Delivered today', 'আজ ডেলিভারড', '今日已送达'],
    'dash.packed_today': ['Packed today', 'আজ প্যাকড', '今日已打包'],
    'dash.qc_today': ['QC decisions today', 'আজকের কিউসি সিদ্ধান্ত', '今日质检决定'],
    'dash.failed': ['Failed deliveries', 'ব্যর্থ ডেলিভারি', '配送失败'],
    'dash.late': ['Late orders', 'বিলম্বিত অর্ডার', '逾期订单'],
    'dash.my_work': ['My work', 'আমার কাজ', '我的工作'],
    'dash.pipeline': ['Pipeline', 'পাইপলাইন', '流程'],
    'dash.workload': ['Staff workload', 'স্টাফের কাজের চাপ', '员工工作量'],
    'dash.recent': ['Recent activity', 'সাম্প্রতিক কার্যক্রম', '最近活动'],

    /* ── page titles / subtitles ──────────────────────────────── */
    'page.packing.sub': ['Prepare goods exactly as per the sales order, then prove it with a photo.', 'সেলস অর্ডার অনুযায়ী পণ্য প্রস্তুত করুন, তারপর ফটো দিয়ে প্রমাণ করুন।', '按销售订单备货，然后拍照证明。'],
    'page.qc.sub': ['Verify packaged items match the order. Approve with proof, or reject with a reason.', 'প্যাক করা পণ্য অর্ডারের সাথে মেলে কিনা যাচাই করুন। প্রমাণসহ অনুমোদন বা কারণসহ বাতিল করুন।', '核对包装商品与订单一致。凭照片批准或说明原因拒绝。'],
    'page.delivery.sub': ['Driver carries, delivery staff hands over — both recorded.', 'ড্রাইভার বহন করে, ডেলিভারি স্টাফ হস্তান্তর করে — দুটোই রেকর্ড হয়।', '司机运输，配送员交付 — 均有记录。'],
    'page.orders.sub': ['Every sales order, from intake to proven delivery.', 'প্রতিটি সেলস অর্ডার, গ্রহণ থেকে প্রমাণিত ডেলিভারি পর্যন্ত।', '每张销售订单，从接收到已证明送达。'],
    'page.proofs.sub': ['Immutable, stamped, and tied to the order chain of custody.', 'অপরিবর্তনীয়, স্ট্যাম্প করা এবং অর্ডার চেইনের সাথে যুক্ত।', '不可更改、带水印，并绑定订单监管链。'],
    'page.users.sub': ['Roles, permissions, and who is carrying what right now.', 'ভূমিকা, অনুমতি এবং এখন কে কী করছেন।', '角色、权限及当前工作分配。'],
    'page.audit.sub': ['Immutable — never edited or deleted through the app.', 'অপরিবর্তনীয় — অ্যাপের মাধ্যমে সম্পাদনা বা মুছে ফেলা যায় না।', '不可更改 — 无法通过应用编辑或删除。'],
    'page.settings.sub': ['Workspace configuration', 'ওয়ার্কস্পেস কনফিগারেশন', '工作区配置'],

    /* ── empty states / misc ──────────────────────────────────── */
    'empty.packing': ['Nothing to pack', 'প্যাক করার কিছু নেই', '没有待打包订单'],
    'empty.packing.sub': ['New orders assigned to you will appear here.', 'আপনার জন্য অ্যাসাইন করা নতুন অর্ডার এখানে দেখা যাবে।', '分配给您的新订单将显示在这里。'],
    'empty.qc': ['Queue clear', 'সারি খালি', '队列已清空'],
    'empty.qc.sub': ['Packed orders will appear here for checking.', 'প্যাক করা অর্ডার যাচাইয়ের জন্য এখানে আসবে।', '已打包订单将显示在这里等待检查。'],
    'empty.orders': ['No orders', 'কোনো অর্ডার নেই', '没有订单'],
    'empty.orders.sub': ['Create a sales order to start the chain.', 'চেইন শুরু করতে একটি সেলস অর্ডার তৈরি করুন।', '创建销售订单以开始流程。'],
    'empty.proofs': ['No proofs yet', 'এখনো প্রমাণ নেই', '暂无凭证'],
    'empty.proofs.sub': ['Stamped photos appear here as the chain moves.', 'চেইন এগোলে স্ট্যাম্প করা ফটো এখানে দেখা যাবে।', '流程推进时，带水印照片将显示在这里。'],
    'misc.on_road': ['On the road', 'পথে আছে', '在途中'],
    'misc.awaiting_dispatch': ['Awaiting dispatch', 'পাঠানোর অপেক্ষায়', '等待发货'],
    'misc.failed_deliveries': ['Failed deliveries', 'ব্যর্থ ডেলিভারি', '配送失败'],
    'misc.demo_data': ['DEMO DATA', 'ডেমো ডেটা', '演示数据'],
    'misc.demo_body': ['You are exploring a generated workspace. Photo proofs are labelled placeholders, not real photos. Wipe it in Settings → Backup & data when you are ready to go live.', 'আপনি একটি তৈরি ওয়ার্কস্পেস দেখছেন। ফটো প্রমাণগুলি লেবেল করা প্লেসহোল্ডার, আসল ফটো নয়। লাইভ করতে Settings → Backup & data থেকে মুছে ফেলুন।', '您正在浏览生成的工作区。照片凭证为标注的占位图，非真实照片。上线前请在 设置 → 备份与数据 中清除。'],
    'misc.photo_proofs': ['Photo proofs', 'ফটো প্রমাণ', '照片凭证'],
    'misc.chain': ['Chain of custody', 'হেফাজতের চেইন', '监管链'],
    'misc.items': ['Items', 'আইটেম', '商品'],
    'misc.units': ['units', 'ইউনিট', '件'],
    'misc.customer': ['Customer', 'ক্রেতা', '客户'],
    'misc.packer': ['Packer', 'প্যাকার', '打包员'],
    'misc.qc': ['QC approver', 'কিউসি অনুমোদক', '质检批准员'],
    'misc.driver': ['Driver', 'ড্রাইভার', '司机'],
    'misc.delivery_staff': ['Delivery staff', 'ডেলিভারি স্টাফ', '配送员'],
    'misc.due': ['Due', 'নির্ধারিত', '截止'],
    'misc.urgent': ['URGENT', 'জরুরি', '紧急'],
    'misc.unassigned': ['Unassigned order', 'অ্যাসাইনহীন অর্ডার', '未分配订单'],
    'misc.claim_start': ['Claim it to start packing.', 'প্যাকিং শুরু করতে দাবি করুন।', '领取以开始打包。'],
    'misc.claim_review_msg': ['Claim the review to proceed.', 'এগিয়ে যেতে রিভিউ দাবি করুন।', '领取审核以继续。'],
    'misc.all_packed': ['All items packed. Take a photo of the packaged goods to finish.', 'সব আইটেম প্যাক হয়েছে। শেষ করতে প্যাক করা পণ্যের ফটো তুলুন।', '所有商品已打包。拍摄包装照片以完成。'],
    'misc.pack_first': ['Pack every item before submitting.', 'জমা দেওয়ার আগে প্রতিটি আইটেম প্যাক করুন।', '提交前请打包所有商品。'],
    'misc.all_matched': ['Everything matches. Capture the QC proof photo to approve.', 'সব মিলেছে। অনুমোদন করতে কিউসি প্রমাণ ফটো তুলুন।', '全部一致。拍摄质检凭证照片以批准。'],
    'misc.check_each': ['Check each item against the order before deciding.', 'সিদ্ধান্তের আগে অর্ডারের সাথে প্রতিটি আইটেম মেলান।', '决定前请逐项核对订单。'],
    'misc.language': ['Language', 'ভাষা', '语言'],
    'misc.currency': ['Currency', 'মুদ্রা', '货币'],
    'misc.theme': ['Theme', 'থিম', '主题'],
    'misc.accent': ['Accent', 'অ্যাকসেন্ট', '强调色'],
    'misc.style': ['Style preset', 'স্টাইল প্রিসেট', '风格预设'],
  };

  const LOCALES = [
    { id: 'en', label: 'English', currency: 'USD' },
    { id: 'bn', label: 'বাংলা', currency: 'BDT' },
    { id: 'zh', label: '中文', currency: 'CNY' },
  ];

  const locale = () => SP.store.state.prefs.locale || 'en';

  function t(key) {
    const entry = DICT[key];
    if (!entry) return key;
    const l = locale();
    const idx = l === 'bn' ? 1 : l === 'zh' ? 2 : 0;
    return entry[idx] || entry[0];
  }

  const CURRENCY_SYMBOLS = { BDT: '৳', USD: '$', CNY: '¥', EUR: '€', INR: '₹' };
  const currency = () => SP.store.state.settings.company.currency || 'BDT';
  const currencySymbol = () => CURRENCY_SYMBOLS[currency()] || currency();

  function setLocale(id, { keepCurrency = false } = {}) {
    if (!LOCALES.some((l) => l.id === id)) return;
    SP.store.update(['prefs', 'settings'], (st) => {
      st.prefs.locale = id;
      if (!keepCurrency) {
        const def = LOCALES.find((l) => l.id === id);
        st.settings.company.currency = def.currency;
      }
    });
    document.documentElement.lang = id;
    SP.store.audit('settings.locale', id, '');
    SP.app?.paintChrome?.();
    SP.router?.refresh?.();
  }

  function setCurrency(cur) {
    SP.store.update(['settings'], (st) => { st.settings.company.currency = cur; });
    SP.store.audit('settings.currency', cur, '');
    SP.router?.refresh?.();
  }

  /** Localized status label (used everywhere via SP.statusOf override). */
  function statusLabel(id) { return t(`status.${id}`); }
  function roleLabel(id) { return t(`role.${id}`); }

  /** SP.fmt.money wired to the workspace currency. */
  function money(v) {
    const x = Number(v) || 0;
    return `${currencySymbol()} ${new Intl.NumberFormat(locale() === 'zh' ? 'zh-CN' : locale() === 'bn' ? 'en-BD' : 'en-US', { maximumFractionDigits: 0 }).format(x)}`;
  }

  return { t, locale, setLocale, setCurrency, currency, currencySymbol, money, statusLabel, roleLabel, LOCALES, DICT };
})();

/* Global shortcut */
SP.t = (key) => SP.i18n.t(key);
