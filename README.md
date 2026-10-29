<div align="center">

<img src="./.github/assets/electric-spiderweb.svg" alt="OneByte Agent — Electric Spiderweb" width="100%">

# ⚡ OneByte Agent

### مساعد Android ذكي — Neon Intelligence. Electric Tools. Your Device, Your Control.

**OneByte Agent** وكيل Android يعمل بالشات والصوت والذاكرة والمهارات والمهام، ويتيح أدوات ويب وتحكمًا اختياريًا بالهاتف، ومركزًا لفتح حسابات التسويق، ومختبرًا يوجّه المتصفح المدمج لقراءة الصفحات والتفاعل معها وإجراء اختبارات HTTP محددة داخل نطاقات مصرح بها.

[![Build Android APK](https://github.com/elssoliman86-codesoli/onebyte-agent/actions/workflows/build-apk.yml/badge.svg)](https://github.com/elssoliman86-codesoli/onebyte-agent/actions/workflows/build-apk.yml)
[![Expo SDK 57](https://img.shields.io/badge/Expo_SDK-57-000020?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev)
[![React Native 0.86](https://img.shields.io/badge/React_Native-0.86-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://reactnative.dev)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript 6](https://img.shields.io/badge/TypeScript-6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Android](https://img.shields.io/badge/Platform-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)](https://github.com/elssoliman86-codesoli/onebyte-agent)
[![License: MIT](https://img.shields.io/badge/License-MIT-f43f5e?style=for-the-badge)](./LICENSE)

**[⬇️ تنزيل APK — OneByte Agent](https://github.com/elssoliman86-codesoli/onebyte-agent/releases) · [📦 الإصدارات](https://github.com/elssoliman86-codesoli/onebyte-agent/releases) · [🧾 سجل التغييرات](https://github.com/elssoliman86-codesoli/onebyte-agent/commits/main) · [🐞 الإبلاغ عن مشكلة](https://github.com/elssoliman86-codesoli/onebyte-agent/issues)**

</div>

---

<div dir="rtl">

## ⚡ فكرة المشروع

**OneByte Agent** تطبيق Android مبني باستخدام **Expo SDK 57** و **React Native 0.86** و **React 19** و **TypeScript 6**. بدل ما يكون مجرد شات، فهو يشغّل حلقة وكيل (Agent Loop) تستطيع فيها النماذج المتوافقة مع واجهة OpenAI أن تطلب أدوات محددة، وينفّذ التطبيق الأدوات وفقًا لقواعد الموافقة والصلاحية.

هو مشروع **Local-first**: بيانات المحادثات والمهارات والذاكرة تُدار محليًا على الجهاز، لكن هذا لا يعني أن كل البيانات تبقى على الهاتف دائمًا؛ نصوص المحادثات التي ترسلها إلى الموديل تذهب إلى مزوّد الذكاء الاصطناعي الذي تختاره، وأدوات الويب والتكاملات الخارجية تتصل بخدماتها عند استخدامها.

### 🌩️ الهوية البصرية: Electric Spiderweb

الرسم الموجود أعلى الصفحة هو عنصر الهوية الأساسي للمشروع: شبكة كهربائية حول نواة مركزية، ومسارات مضيئة مستوحاة من **Neon Cyan / Electric Blue / Lightning Red**. الفكرة البصرية تعكس ارتباط أجزاء التطبيق ببعضها:

- ⚡ **Model** — الموديل الذي يفهم الطلب ويقترح الخطوات.
- 🔌 **Tools** — الأدوات التي تنفّذ عمليات محددة.
- 🧠 **Memory** — سياق محلي يساعد على الاحتفاظ بالمعلومات المهمة.
- 🛡️ **Approval** — طبقة تحكّم للموافقة على إجراءات الهاتف الحساسة.

</div>

## 🧭 المحتويات

- [المزايا](#-المزايا)
- [مساحات العمل](#-مساحات-العمل)
- [طريقة تنظيم المشروع](#-طريقة-تنظيم-المشروع)
- [التثبيت والتشغيل](#-التثبيت-والتشغيل)
- [الإعداد الأول](#-الإعداد-الأول)
- [الأدوات والأوامر](#-الأدوات-والأوامر)
- [الخصوصية والأمان](#-الخصوصية-والأمان)
- [القيود المعروفة](#-القيود-المعروفة)
- [البناء والتحقق](#-البناء-والتحقق)
- [المساهمة والترخيص](#-المساهمة-والترخيص)

---

<div dir="rtl">

## ✨ المزايا

### 💬 الشات والذكاء الاصطناعي

- بث مباشر للردود (Streaming) من مزوّدي النماذج المتوافقين مع OpenAI Chat Completions.
- حلقة أدوات: يمكن للموديل طلب أداة، انتظار النتيجة، ثم متابعة الرد.
- إعداد عنوان API واسم الموديل والمفتاح، مع قوالب لمزوّدين متعددين ودعم نقاط النهاية المتوافقة.
- فحص اتصال الموديل ومساعدة في فهم أخطاء HTTP الشائعة مثل `401` و`404` و`429`.
- دعم إرفاق الصور والملفات في مسار الشات، بحسب نوع الملف والموديل المستخدم وقدرات المزوّد.
- إيقاف الطلب الجاري من واجهة الشات، بما في ذلك انتظار الموديل والمهام التي تدعم الإلغاء.
- دعم الرسائل التي تحتوي على نصوص متعددة الأسطر وصور متعددة، مع محاولة التعامل مع الطلبات الطويلة عبر تقسيم النص أو تلخيصه داخليًا عند الحاجة. يظل التنفيذ محدودًا بسياق الموديل وحدود المزوّد.
- واجهة شات مُحسّنة: رأس مضغوط، سجل محادثات في الدرج الجانبي، فقاعة مستخدم بعرض مناسب للنص، وإجراءات للنسخ والتعديل، مع إجراءات أيقونية لرسائل المساعد.

### 🧠 الذاكرة والمهارات والسياق

- حفظ معلومات مختارة في ذاكرة محلية يمكن للأدوات الرجوع إليها.
- حفظ المهارات وقراءة التعليمات الكاملة لمهارة عند الحاجة.
- بحث في المحادثات المحفوظة، بما في ذلك المحتوى الذي لم يعد ظاهرًا بالكامل في سياق الموديل.
- تلخيص أجزاء من سياق المحادثة للمساعدة في التعامل مع المحادثات الطويلة.
- مهام يومية وتذكيرات محلية يمكنها فتح الطلب المرتبط بها داخل الشات.

### 📱 أدوات الهاتف — عند تفعيلها فقط

يمكن لخدمة Android الأصلية استخدام Accessibility لتنفيذ عمليات مسموحة داخل الهاتف، مثل:

- قراءة عناصر واجهة الشاشة الحالية.
- فتح تطبيق أو رابط.
- الضغط على عنصر، وكتابة نص في حقل عادي، والتمرير.
- تنفيذ بعض مفاتيح النظام والانتظار حتى تستقر الشاشة.
- عرض طلبات الموافقة قبل استخدام أدوات قراءة الجهاز أو التأثير عليه.

التحكم في الهاتف **اختياري**، ويتطلب تثبيت نسخة Android مبنية مع الوحدة الأصلية ثم تفعيل خدمة إمكانية الوصول من إعدادات النظام. هذه الوظائف لا تعمل بالكامل داخل Expo Go.

### 🌐 أدوات الويب والمتصفح المدمج

- البحث في الويب باستخدام DuckDuckGo وجلب محتوى صفحة عامة عندما يطلب المستخدم ذلك.
- في نسخة Android، يستطيع الوكيل توجيه WebView المدمج لفتح رابط مصرح به، وقراءة عنوان الصفحة ونصها والعناصر التفاعلية، والنقر والكتابة في الحقول غير الحساسة، والتمرير والانتظار.
- يمكنه إرسال طلبات HTTP محددة من سياق الصفحة وتحليل status/headers/الجسم وزمن الاستجابة، ثم استخدام نتيجة الأداة لمتابعة الاستدلال.
- لوحة **حركة الشبكة** تلتقط داخل النطاق المصرّح به طلبات JavaScript من نوع `fetch` و`XHR` و`sendBeacon` والتنقلات الرئيسية، مع الحالة والمدة ومعاينة الاستجابة وحجب بيانات الاعتماد الشائعة. يمكن نقل الطلب الملتقط إلى محرّر HTTP في Cybersecurity Lab لتعديله ثم إرساله يدويًا بعد التحقق من النطاق.
- هذا الالتقاط ليس Proxy كاملًا ولا يضمن تسجيل كل الصور والملفات الثابتة وWebSocket أو طلبات Service Worker. إعادة الطلب من سياق الصفحة تظل خاضعة لـCORS؛ استخدم HTTP Lab في Android عند الحاجة إلى طلب مباشر.

### 🧩 عرض المحتوى

- عرض Markdown بعناوين وقوائم بدل عرضه كنص خام.
- تنسيق كتل الكود مع إمكانية نسخها، ودعم تنزيل كتل الكود كملف عند توفر الإجراء في الواجهة.
- عرض مخططات Mermaid، مع مراعاة ألوان `classDef` و`class` و`:::` الموجودة في المصدر.
- معاينة Mermaid بمحرك Mermaid الأصلي في العرض المدعوم داخل التطبيق/الويب.
- معاينة HTML داخل WebView مع إمكانية إعادة التحميل أو فتحها في المتصفح عند توفرها.
- دعم الثيم الفاتح والداكن والتلقائي.

### 💻 واجهة الكمبيوتر المصاحبة

يمكن تشغيل خادم PC من إعدادات التطبيق ثم فتح عنوانه من متصفح كمبيوتر على **نفس شبكة Wi-Fi**. تفتح الواجهة المصاحبة بتخطيط كمبيوتر مستقل، ويمكن تخصيص الثيم واللون من إعداداتها أو مزامنتها مع إعداد الهاتف. يسجّل المستخدم الدخول باستخدام PIN، وتظل موافقات إجراءات الهاتف الحساسة مرتبطة بالجهاز.

> استخدم هذه الواجهة على شبكة موثوقة فقط. الخادم المحلي ليس بديلًا عن نشر خدمة آمنة على الإنترنت، ولا ينبغي فتح منفذه للعامة أو تحويله مباشرة إلى عنوان عام.

### 🛠️ مساحات عمل متخصصة

- **Developer Lab:** مساحة لتجارب وتحرير المحتوى البرمجي وبعض أدوات المعاينة.
- **Marketing Studio:** مركز سريع لفتح حسابات YouTube Studio وTikTok وFacebook وInstagram وWhatsApp Web/Desktop وTelegram Web، مع فتح مساعد التسويق لكتابة المحتوى وخطط الحملات.
- **Cybersecurity Lab / Bug Hunter:** إدارة نطاقات الاختبار، وتحرير طلب HTTP (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS)، وتعديل headers/body، وإرسال الطلب أو إلغاؤه، وقراءة status/الوقت/مقتطف الاستجابة، والرجوع إلى سجل الطلبات.
- **اختبار ويب من المتصفح المدمج:** عند طلب اختبار هدف مصرح به، يرجع الموديل إلى المهارات المحفوظة — ومنها مهارة اختبار أمن الويب وأي مهارة متخصصة بنوع الثغرة — ثم يوجّه WebView لقراءة الصفحة والتفاعل معها وإرسال طلبات اختبار محددة.

## 🏗️ طريقة تنظيم المشروع

```
onebyte-agent/
├── app/                    # Expo Router: المسارات والصفحات
│   ├── (tabs)/             # تبويبات الشاشات الرئيسية
│   ├── lab/                # Developer Lab / Cybersecurity Lab / Marketing Studio
│   ├── settings/           # الإعدادات
│   └── _layout.tsx         # التخطيط الجذري
├── components/             # مكونات UI مشتركة
│   ├── chat/               # مكونات الشات والفقاعات
│   ├── markdown/           # عرض Markdown وMermaid
│   └── ui/                 # أزرار، حقول، بطاقات، شرائح
├── hooks/                  # خطافات React مخصصة
├── services/               # خدمات التطبيق (Agent Loop، تخزين، شبكة، إلخ)
├── modules/                # وحدات أصلية (device-control, speech-recognition)
├── plugins/                # إضافات Expo config plugins
├── scripts/                # سكريبتات البناء والأتمتة
├── server/                 # خادم PC المصاحب
├── assets/                 # صور، خطوط، أيقونات
├── .github/                # سير عمل CI/CD
├── app.json                # تكوين Expo
├── package.json            # تبعيات المشروع
├── tsconfig.json           # تكوين TypeScript
└── README.md               # هذا الملف
```

### التقنيات الأساسية

| الطبقة | التقنية | الإصدار |
|--------|---------|---------|
| **Runtime** | Expo SDK | 57 |
| **UI Framework** | React Native | 0.86 |
| **React** | React | 19 |
| **Language** | TypeScript | 6 |
| **Routing** | Expo Router | ~57 (Typed Routes) |
| **Compiler** | React Compiler | Enabled (beta) |
| **Styling** | React Native (StyleSheet) | — |
| **Animations** | Reanimated | 4.5 |
| **Gestures** | Gesture Handler + Keyboard Controller | ~2.32 / 1.21 |
| **Storage** | AsyncStorage + SecureStore | 2.2 / 57 |
| **WebView** | react-native-webview | 13.17 |
| **Notifications** | expo-notifications | 57 |
| **Media** | expo-image-picker, document-picker, clipboard | 57 |

### ميزات المترجم والتطوير

- **React Compiler** (beta): تفعيل تلقائي لتحسين إعادة العرض عبر `babel-plugin-react-compiler`.
- **Typed Routes**: مسارات آمنة من الناحية النوعية عبر `experiments.typedRoutes: true`.
- **Expo Config Plugin** مخصص: `withAndroidLocalHttp` للسماح باتصالات HTTP محلية على عناوين محددة.

## 🚀 التثبيت والتشغيل

### المتطلبات

- Node.js 20+
- pnpm 9+
- Android Studio + SDK (API 34+) — للبناء على Android
- Expo CLI: `pnpm add -g expo-cli` (اختياري، يمكن استخدام `pnpm exec expo`)

### خطوات سريعة

```bash
# استنساخ المستودع
git clone https://github.com/elssoliman86-codesoli/onebyte-agent.git
cd onebyte-agent

# تثبيت التبعيات
pnpm install

# تشغيل خادم التطوير (Expo)
pnpm dev

# فتح على جهاز/محاكي Android
# اضغط 'a' في طرفية Expo، أو امسح رمز QR بتطبيق Expo Go
```

### بناء APK للإنتاج

```bash
# بناء محلي (يتطلب إعداد EAS أو Gradle محلي)
pnpm build

# أو عبر EAS Build (موصى به)
eas build --platform android --profile production
```

> ملاحظة: نسخة Expo Go لا تدعم الوحدات الأصلية (`device-control`, `speech-recognition`). للاستفادة من أدوات الهاتف، يجب بناء نسخة Development Build أو Production APK.

## ⚙️ الإعداد الأول

1. افتح التطبيق على الجهاز.
2. من الشاشة الرئيسية، ادخل **الإعدادات** → **إعدادات الموديل**.
3. اختر مزوّدًا (قالب) أو أدخل عنوان API مخصص.
4. ضع مفتاح API واختبر الاتصال.
5. فعّل **التحكم في الهاتف** من الإعدادات إذا أردت، ثم امنح إذن إمكانية الوصول (Accessibility) من إعدادات النظام.
6. (اختياري) فعّل **خادم PC** من الإعدادات للوصول من متصفح الكمبيوتر على نفس الشبكة.

## 🛠️ الأدوات والأوامر

| الأمر | الوصف |
|--------|-------|
| `pnpm dev` | تشغيل خادم تطوير Expo مع إعدادات Replit (إن وجد). |
| `pnpm build` | تشغيل سكريبت البناء المحلي (`scripts/build.js`). |
| `pnpm serve` | تشغيل خادم PC المصاحب (`server/serve.js`). |
| `pnpm typecheck` | فحص الأنواع عبر `tsc --noEmit`. |

### سكريبتات مفيدة أخرى

```bash
# تنظيف الكاش وبدء جديد
pnpm exec expo start -c

# فحص 린ت (إذا مضاف)
pnpm lint

# تحديث تبعيات Expo
pnpm expo install --fix
```

## 🔒 الخصوصية والأمان

- **Local-first**: المحادثات، الذاكرة، المهارات، والمهام مخزنة محليًا على الجهاز (AsyncStorage / SecureStore).
- **مفاتيح API**: تُخزّن في `expo-secure-store` مشفرةً بواسطة Android Keystore / iOS Keychain.
- **الشبكة**: الطلبات الصادرة تذهب فقط إلى مزوّد الموديل المحدد، أو إلى عناوين الويب التي يطلبها المستخدم صراحةً، أو إلى نطاقات الاختبار المضافة في Cybersecurity Lab.
- **الوصول للهاتف**: أدوات قراءة الشاشة والتنقل تتطلب خدمة Accessibility موافقة من المستخدم، ولا تُفعّل تلقائيًا.
- **لا تتبع**: لا توجد تحليلات استخدام، ولا تقارير أعطال ترسل لجهة خارجية إلا إذا أضفتها أنت.

## ⚠️ القيود المعروفة

- **Expo Go**: الوحدات الأصلية (`device-control`, `speech-recognition`) لا تعمل؛ تحتاج Development Build.
- **iOS**: المشروع يستهدف Android حاليًا؛ دعم iOS غير مختبر وقد يحتاج تعديلات في الأذونات والإضافات.
- **سياق الموديل**: المحادثات الطويلة قد تتجاوز نافذة السياق؛ ميزة التلخيص تساعد لكنها ليست بديلًا عن إدارة السياق اليدوية.
- **CORS في WebView**: الطلبات المرسلة من المتصفح المدمج تخضع لسياسة نفس المنشأ؛ استخدم HTTP Lab للطلبات المباشرة.
- **React Compiler (beta)**: قد تظهر تحذيرات أو سلوكيات غير متوقعة مع مكونات معينة؛ راقب التحديثات.

## 🏗️ البناء والتحقق

### CI/CD (GitHub Actions)

سير العمل `build-apk.yml` ينفّذ عند كل push إلى `main` وعند إنشاء tag بالإصدار:

1. تثبيت التبعيات (`pnpm install --frozen-lockfile`)
2. فحص الأنواع (`pnpm typecheck`)
3. بناء APK عبر EAS أو Gradle محلي
4. رفع الـ Artifact وإصدار Release تلقائي

### فحص محلي قبل الـ Push

```bash
pnpm typecheck   # يجب أن يمر بدون أخطاء
# اختبر على جهاز/محاكي حقيقي قبل الدفع
```

## 🤝 المساهمة والترخيص

- **الترخيص:** [MIT](./LICENSE) — استخدم، عدّل، وزّع بحرية مع إبقاء إشعار الترخيص.
- **المساهمات:** مرحب بها! افتح Issue للمناقشة، ثم أرسل Pull Request.
- **قواعد الكود:** TypeScript صارم، مكونات وظيفية، تعليقات بالعربية للواجهات العامة، واحترام بنية المجلدات أعلاه.

---

<div align="center">

**OneByte Agent** — صُنع بـ ⚡ Neon Intelligence

</div>