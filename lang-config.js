/**
 * GISCO Multi-Language Configuration v2.0
 * Supports: English (EN), Arabic (AR), Urdu (UR), Hindi (HI)
 * Author: Mostafa Ahmed Hamdy
 * 
 * HOW TO USE:
 * 1. Include this script in your page: <script src="lang-config.js"></script>
 * 2. Add data-lang="key" attributes to translatable elements
 * 3. For placeholder: data-lang-placeholder="key"
 * 4. For value: data-lang-value="key"
 * 5. Add <div id="langToggleWrapper"></div> where you want the toggle button
 * 6. To auto-translate dynamic content, use: translateElement(el, 'key')
 * 7. Listen for 'languageChanged' event to re-render dynamic content
 */

const LANGUAGES = {
  EN: { name: 'English', native: 'English', dir: 'ltr', flag: '🇬🇧', fontScale: 1 },
  AR: { name: 'Arabic', native: 'العربية', dir: 'rtl', flag: '🇸🇦', fontScale: 1 },
  UR: { name: 'Urdu', native: 'اردو', dir: 'rtl', flag: '🇵🇰', fontScale: 0.95 },
  HI: { name: 'Hindi', native: 'हिन्दी', dir: 'ltr', flag: '🇮🇳', fontScale: 1 }
};

const DEFAULT_LANG = 'EN';
let currentLang = localStorage.getItem('gisco_lang') || DEFAULT_LANG;

// Common translations shared across all pages
const COMMON_TRANSLATIONS = {
  // Navigation / Header
  'home': { EN: 'Home', AR: 'الرئيسية', UR: 'ہوم', HI: 'होम' },
  'back_home': { EN: '⬅ Home', AR: '⬅ الرئيسية', UR: '⬅ ہوم', HI: '⬅ होम' },
  'gisco': { EN: 'GISCO', AR: 'جيسكو', UR: 'جسکو', HI: 'जिस्को' },
  'refresh': { EN: '🔄 Refresh', AR: '🔄 تحديث', UR: '🔄 ریفریش', HI: '🔄 रिफ्रेश' },
  'sync_refresh': { EN: '🔄 Sync / Refresh', AR: '🔄 مزامنة / تحديث', UR: '🔄 سنک / ریفریش', HI: '🔄 सिंक / रिफ्रेश' },
  'print': { EN: '🖨️ Print', AR: '🖨️ طباعة', UR: '🖨️ پرنٹ', HI: '🖨️ प्रिंट' },
  'add_new': { EN: '➕ Add New', AR: '➕ إضافة جديد', UR: '➕ نیا شامل کریں', HI: '➕ नया जोड़ें' },
  'save': { EN: 'Save', AR: 'حفظ', UR: 'محفوظ کریں', HI: 'सेव करें' },
  'cancel': { EN: 'Cancel', AR: 'إلغاء', UR: 'منسوخ کریں', HI: 'रद्द करें' },
  'delete': { EN: 'Delete', AR: 'حذف', UR: 'حذف کریں', HI: 'हटाएं' },
  'edit': { EN: 'Edit', AR: 'تعديل', UR: 'ترمیم', HI: 'संपादित करें' },
  'confirm': { EN: 'Confirm', AR: 'تأكيد', UR: 'تصدیق', HI: 'पुष्टि करें' },
  'search': { EN: 'Search...', AR: 'بحث...', UR: 'تلاش کریں...', HI: 'खोजें...' },
  'search_placeholder': { EN: 'Search ...', AR: 'بحث ...', UR: 'تلاش کریں ...', HI: 'खोजें ...' },
  'loading': { EN: 'Loading...', AR: 'جاري التحميل...', UR: 'لوڈ ہو رہا ہے...', HI: 'लोड हो रहा है...' },
  'no_data': { EN: 'No data available', AR: 'لا توجد بيانات', UR: 'ڈیٹا دستیاب نہیں', HI: 'कोई डेटा उपलब्ध नहीं' },
  'confirm_delete': { EN: 'Are you sure you want to delete?', AR: 'هل أنت متأكد أنك تريد الحذف؟', UR: 'کیا آپ واقعی حذف کرنا چاہتے ہیں؟', HI: 'क्या आप वाकई हटाना चाहते हैं?' },
  'actions': { EN: 'Actions', AR: 'إجراءات', UR: 'کارروائیاں', HI: 'कार्रवाइयां' },
  'total': { EN: 'Total', AR: 'المجموع', UR: 'کل', HI: 'कुल' },
  'records': { EN: 'Records', AR: 'سجلات', UR: 'ریکارڈز', HI: 'रिकॉर्ड' },
  'results': { EN: 'Results:', AR: 'النتائج:', UR: 'نتائج:', HI: 'परिणाम:' },
  'filter': { EN: 'Filter', AR: 'تصفية', UR: 'فلٹر', HI: 'फ़िल्टर' },
  'clear': { EN: 'Clear', AR: 'مسح', UR: 'صاف کریں', HI: 'साफ़ करें' },
  'all': { EN: 'All', AR: 'الكل', UR: 'تمام', HI: 'सभी' },
  'status': { EN: 'Status', AR: 'الحالة', UR: 'حالت', HI: 'स्थिति' },
  'date': { EN: 'Date', AR: 'التاريخ', UR: 'تاریخ', HI: 'तारीख' },
  'description': { EN: 'Description', AR: 'الوصف', UR: 'تفصیل', HI: 'विवरण' },
  'unit': { EN: 'Unit', AR: 'الوحدة', UR: 'یونٹ', HI: 'इकाई' },
  'quantity': { EN: 'Qty', AR: 'الكمية', UR: 'مقدار', HI: 'मात्रा' },
  'code': { EN: 'Code', AR: 'الكود', UR: 'کوڈ', HI: 'कोड' },
  'name': { EN: 'Name', AR: 'الاسم', UR: 'نام', HI: 'नाम' },
  'export': { EN: 'Export', AR: 'تصدير', UR: 'برآمد کریں', HI: 'निर्यात करें' },
  'import': { EN: 'Import', AR: 'استيراد', UR: 'درآمد کریں', HI: 'आयात करें' },
  'success': { EN: 'Success', AR: 'نجاح', UR: 'کامیابی', HI: 'सफलता' },
  'error': { EN: 'Error', AR: 'خطأ', UR: 'غلطی', HI: 'त्रुटि' },
  'info': { EN: 'Info', AR: 'معلومات', UR: 'معلومات', HI: 'जानकारी' },
  'designed_by': { EN: 'Designed & Programmed by: Mostafa Ahmed Hamdy', AR: 'تصميم وبرمجة: مصطفى النجار', UR: 'ڈیزائن اور پروگرامنگ: مصطفی النجار', HI: 'डिज़ाइन और प्रोग्रामिंग: मुस्तफा अल-नज्जर' },
  'select_language': { EN: 'Select Language', AR: 'اختر اللغة', UR: 'زبان منتخب کریں', HI: 'भाषा चुनें' },
  'no_results': { EN: 'No results found', AR: 'لا توجد نتائج', UR: 'کوئی نتیجہ نہیں ملا', HI: 'कोई परिणाम नहीं मिला' },
  'category': { EN: 'Category', AR: 'الفئة', UR: 'زمرہ', HI: 'श्रेणी' },
  'start_date': { EN: 'Start Date', AR: 'تاريخ البداية', UR: 'شروع کی تاریخ', HI: 'आरंभ तिथि' },
  'end_date': { EN: 'End Date', AR: 'تاريخ النهاية', UR: 'اختتام کی تاریخ', HI: 'समाप्ति तिथि' },
  'serial': { EN: 'SN', AR: 'م', UR: 'نمبر', HI: 'क्रमांक' },
  'file_no': { EN: 'File No', AR: 'رقم الملف', UR: 'فائل نمبر', HI: 'फ़ाइल नंबर' },
  'employee_name': { EN: 'Employee Name', AR: 'اسم الموظف', UR: 'ملازم کا نام', HI: 'कर्मचारी का नाम' },
  'login': { EN: 'Login', AR: 'تسجيل الدخول', UR: 'لاگ ان', HI: 'लॉगिन' },
  'logout': { EN: 'Logout', AR: 'تسجيل الخروج', UR: 'لاگ آؤٹ', HI: 'लॉगआउट' },
  'email': { EN: 'Email', AR: 'البريد الإلكتروني', UR: 'ای میل', HI: 'ईमेल' },
  'password': { EN: 'Password', AR: 'كلمة المرور', UR: 'پاس ورڈ', HI: 'पासवर्ड' },
  'sign_in': { EN: 'Sign In', AR: 'دخول', UR: 'سائن ان', HI: 'साइन इन' },
  'dashboard': { EN: 'Dashboard', AR: 'لوحة التحكم', UR: 'ڈیش بورڈ', HI: 'डैशबोर्ड' },
  'inventory': { EN: 'Inventory', AR: 'المخزون', UR: 'انوینٹری', HI: 'इन्वेंट्री' },
  'reports': { EN: 'Reports', AR: 'التقارير', UR: 'رپورٹس', HI: 'रिपोर्ट' },
  'warehouse': { EN: 'Warehouse', AR: 'المستودع', UR: 'گودام', HI: 'गोदाम' },
  'management': { EN: 'Management', AR: 'الإدارة', UR: 'انتظام', HI: 'प्रबंधन' },
  'submit': { EN: 'Submit', AR: 'إرسال', UR: 'جمع کرائیں', HI: 'जमा करें' },
  'update': { EN: 'Update', AR: 'تحديث', UR: 'اپ ڈیٹ', HI: 'अपडेट करें' },
  'download': { EN: 'Download', AR: 'تحميل', UR: 'ڈاؤن لوڈ', HI: 'डाउनलोड' },
  'upload': { EN: 'Upload', AR: 'رفع', UR: 'اپ لوڈ', HI: 'अपलोड' },
  'yes': { EN: 'Yes', AR: 'نعم', UR: 'ہاں', HI: 'हाँ' },
  'no': { EN: 'No', AR: 'لا', UR: 'نہیں', HI: 'नहीं' },
  'close': { EN: 'Close', AR: 'إغلاق', UR: 'بند کریں', HI: 'बंद करें' },
  'open': { EN: 'Open', AR: 'فتح', UR: 'کھولیں', HI: 'खोलें' },
  'help': { EN: 'Help', AR: 'مساعدة', UR: 'مدد', HI: 'मदद' },
  'settings': { EN: 'Settings', AR: 'الإعدادات', UR: 'ترتیبات', HI: 'सेटिंग्स' },
  'notes': { EN: 'Notes', AR: 'ملاحظات', UR: 'نوٹس', HI: 'नोट्स' },
  'remarks': { EN: 'Remarks', AR: 'ملاحظات', UR: 'تبصرے', HI: 'टिप्पणियाँ' }
};

function getTranslation(key) {
  const translations = COMMON_TRANSLATIONS[key];
  if (!translations) return key;
  return translations[currentLang] || translations[DEFAULT_LANG] || key;
}

function getLanguageInfo() {
  return LANGUAGES[currentLang] || LANGUAGES[DEFAULT_LANG];
}

function isRTL() {
  return getLanguageInfo().dir === 'rtl';
}

function setLanguage(lang) {
  if (!LANGUAGES[lang]) return;
  currentLang = lang;
  localStorage.setItem('gisco_lang', lang);
  
  // Update HTML lang attribute and direction
  document.documentElement.lang = lang.toLowerCase();
  document.documentElement.dir = LANGUAGES[lang].dir;
  
  // Apply font scale
  document.documentElement.style.fontSize = `${LANGUAGES[lang].fontScale * 100}%`;
  
  // Apply RTL-specific body class
  document.body.classList.toggle('rtl-mode', isRTL());
  document.body.classList.toggle('ltr-mode', !isRTL());
  
  // Re-translate all elements
  translatePage();
  
  // Update language toggle button text
  updateLangToggle();
  
  // Trigger custom event for pages that need to re-render dynamic content
  document.dispatchEvent(new CustomEvent('languageChanged', { detail: { language: lang } }));
  
  return lang;
}

function initializeLanguage() {
  const savedLang = localStorage.getItem('gisco_lang') || DEFAULT_LANG;
  setLanguage(savedLang);
}

function translatePage() {
  // Translate all elements with data-lang attribute
  document.querySelectorAll('[data-lang]').forEach(el => {
    const key = el.getAttribute('data-lang');
    const placeholder = el.getAttribute('data-lang-placeholder');
    
    if (placeholder === 'true') {
      el.placeholder = getTranslation(key);
    } else {
      el.textContent = getTranslation(key);
    }
  });
  
  // Translate input placeholders
  document.querySelectorAll('[data-lang-placeholder]').forEach(el => {
    el.placeholder = getTranslation(el.getAttribute('data-lang-placeholder'));
  });
  
  // Translate title attributes
  document.querySelectorAll('[data-lang-title]').forEach(el => {
    el.title = getTranslation(el.getAttribute('data-lang-title'));
  });
  
  // Translate value attributes (for buttons/inputs)
  document.querySelectorAll('[data-lang-value]').forEach(el => {
    el.value = getTranslation(el.getAttribute('data-lang-value'));
  });
}

function updateLangToggle() {
  const toggleBtns = document.querySelectorAll('.lang-toggle-btn');
  toggleBtns.forEach(btn => {
    const lang = btn.getAttribute('data-lang');
    if (lang === currentLang) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update the main toggle display if it exists
  const mainToggle = document.getElementById('langToggleMain');
  if (mainToggle) {
    const info = LANGUAGES[currentLang];
    mainToggle.innerHTML = `${info.flag} ${info.native}`;
  }
}

// Create language toggle HTML
function createLanguageToggleHTML() {
  return `
    <div class="lang-toggle-wrapper" style="position:relative;display:inline-block;">
      <button id="langToggleMain" class="btn lang-toggle-main" onclick="toggleLangMenu()" style="min-width:100px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);backdrop-filter:blur(10px);border-radius:8px;padding:8px 14px;cursor:pointer;color:inherit;font-size:0.85rem;display:inline-flex;align-items:center;gap:8px;transition:all 0.2s;">
        ${LANGUAGES[currentLang].flag} ${LANGUAGES[currentLang].native} <span style="font-size:0.7rem;opacity:0.7;">▾</span>
      </button>
      <div id="langMenu" class="lang-menu" style="display:none;position:absolute;top:100%;right:0;margin-top:6px;background:rgba(15,23,42,0.95);backdrop-filter:blur(15px);border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:6px;min-width:160px;z-index:9999;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
        ${Object.entries(LANGUAGES).map(([code, info]) => `
          <button class="lang-toggle-btn${code === currentLang ? ' active' : ''}" data-lang="${code}" onclick="selectLanguage('${code}')" style="display:flex;align-items:center;gap:10px;width:100%;padding:10px 14px;border:none;border-radius:8px;background:${code === currentLang ? 'rgba(59,130,246,0.2)' : 'transparent'};color:${code === currentLang ? '#93c5fd' : '#f8fafc'};cursor:pointer;font-size:0.9rem;font-family:inherit;transition:all 0.15s;text-align:left;">
            <span style="font-size:1.2rem;">${info.flag}</span>
            <span style="flex:1;">${info.native}</span>
            <span style="font-size:0.75rem;opacity:0.6;">${info.name}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function toggleLangMenu() {
  const menu = document.getElementById('langMenu');
  if (!menu) return;
  const isVisible = menu.style.display === 'block';
  menu.style.display = isVisible ? 'none' : 'block';
}

function selectLanguage(lang) {
  setLanguage(lang);
  document.getElementById('langMenu').style.display = 'none';
}

// Close language menu when clicking outside
document.addEventListener('click', function(e) {
  const wrapper = document.querySelector('.lang-toggle-wrapper');
  if (wrapper && !wrapper.contains(e.target)) {
    const menu = document.getElementById('langMenu');
    if (menu) menu.style.display = 'none';
  }
});

// Add RTL-specific CSS to the page
(function injectRTLCSS() {
  const style = document.createElement('style');
  style.textContent = `
    body.rtl-mode { direction: rtl; text-align: right; }
    body.ltr-mode { direction: ltr; text-align: left; }
    body.rtl-mode .lang-menu { right: auto; left: 0; }
    body.rtl-mode .lang-toggle-btn { text-align: right !important; }
    body.rtl-mode .fa-arrow-left::before { content: "\\f061"; }
    body.rtl-mode .fa-arrow-right::before { content: "\\f060"; }
    body.rtl-mode .fa-chevron-left::before { content: "\\f054"; }
    body.rtl-mode .fa-chevron-right::before { content: "\\f053"; }
    body.rtl-mode input, 
    body.rtl-mode textarea, 
    body.rtl-mode select { text-align: right; }
    body.rtl-mode th { text-align: right; }
    body.rtl-mode td { text-align: right; }
    .lang-toggle-main:hover { background: rgba(255,255,255,0.15) !important; }
    .lang-toggle-btn:hover { background: rgba(255,255,255,0.08) !important; }
    .lang-toggle-btn.active { background: rgba(59,130,246,0.2) !important; color: #93c5fd !important; }
  `;
  document.head.appendChild(style);
})();

// Utility: Apply translations to dynamically created content
function translateElement(el, key) {
  if (!el || !key) return;
  const translation = getTranslation(key);
  if (el.placeholder !== undefined && el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    el.placeholder = translation;
  } else {
    el.textContent = translation;
  }
}

