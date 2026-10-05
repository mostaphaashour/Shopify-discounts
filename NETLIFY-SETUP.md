# النشر على Netlify

هذه النسخة تتضمن إصلاح قبول طلبات نفس الموقع، وجلسات Shopify المشفّرة في كوكي HttpOnly وSecure على HTTPS. لا تستخدم Netlify Blobs ولا قاعدة بيانات لحفظ مفاتيح Shopify. Firebase يحتفظ بالعضويات والطلبات وسجل العمليات فقط.

## 1. الملفات وGitHub

استبدل ملفات المشروع القديمة بمحتويات هذا المجلد مع الاحتفاظ بمجلد .git الخاص بمستودعك. لا تنقل node_modules أو .next. تأكد أن package.json وnetlify.toml في جذر المستودع، ثم:

```powershell
git add .
git commit -m "Prepare Shopify app for Netlify"
git push
```

لا ترفع .env.local أو مفاتيح خاصة. لا تستخدم إعداد output: export؛ التطبيق يحتاج API على السيرفر.

## 2. متغيرات Netlify

في Project configuration → Environment variables أضف المتغيرات التالية بقيم مشروعك. اجعلها متاحة للبناء وFunctions، ثم نفّذ نشرًا جديدًا:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
FIREBASE_PROJECT_ID=...
LOCAL_TEMP_LOGIN=false
SESSION_ENCRYPTION_KEY=...
```

لتوليد SESSION_ENCRYPTION_KEY شغّل الأمر التالي على جهازك، وانسخ الناتج إلى متغير Netlify فقط. لا ترسله لأحد ولا تضعه في GitHub أو متغير يبدأ بـNEXT_PUBLIC:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

المفتاح 64 رمز hex. احتفظ بنفس القيمة بين عمليات النشر حتى تستمر الجلسات. تغييره يبطل كل جلسات ربط Shopify القديمة. لا تنسخ النصوص التوضيحية الموجودة في .env.example كقيم فعلية.

## 3. إعداد البناء

netlify.toml المرفق يحدد npm run build، ومجلد .next، وNode 24. اترك Base directory فارغًا إذا كان package.json في جذر المستودع. لا تستخدم npm run dev للبناء. Netlify يضيف محوّل Next.js تلقائيًا؛ لا تحتاج تثبيت @netlify/plugin-nextjs يدويًا.

## 4. Firebase

اتبع FIREBASE-SETUP.md لنشر firestore.rules وتفعيل Google وتعيين admins/{UID} بحقل enabled=true. أضف shopify-discounty.netlify.app وأي دومين مخصص إلى Authentication → Settings → Authorized domains.

## 5. التحقق بعد النشر

انتظر Published، ثم جرّب Google بحساب الأدمن. اربط متجر Shopify ثم عاين SKU واحدًا. جرّب حسابًا عاديًا وتأكد أن أدوات المتجر لا تظهر قبل الاشتراك المعتمد. وافق على الدفع فقط بعد مراجعة التحويل بنفسك.

الربط الحالي يستخدم Shopify client_credentials: التطبيق والمتجر يجب أن يكونا داخل نفس مؤسسة Shopify. لم تُضف دورة OAuth لمتاجر العملاء خارج المؤسسة. هذه نقطة منفصلة عن الاشتراك في تطبيقك.

## الجلسة والحدود

- المتصفح يحفظ بيانات الاتصال مشفّرة بـAES-256-GCM، ومفتاح التشفير على السيرفر فقط. الكوكي HttpOnly تمنع قراءة JavaScript لها.
- كل طلب يتحقق من Firebase والعضوية، والجلسة مرتبطة بـUID ولها حد أقصى 24 ساعة.
- الفصل يمسح الكوكي من المتصفح. لأنه لا توجد قاعدة جلسات، نسخة كوكي مسروقة لا يمكن إبطالها منفردة من السيرفر؛ إيقاف العضوية أو تغيير مفتاح التشفير يمنع استخدامها حسب الحالة. تسجيل الخروج يمنع الطلبات بدون مصادقة Firebase لكنه لا يلغي نسخ توكن Firebase التي لم تنتهِ؛ استخدم إيقاف العضوية عند الحاجة.
- حد حجم الكوكي محمي. إذا كانت بيانات الاتصال ضخمة فلن يُحفظ الربط وستظهر رسالة واضحة، بدل نجاح ظاهري ثم فشل الطلب التالي.
- لا تُرسل المفاتيح إلى Firestore أو Blobs. يتم إرسالها إلى سيرفر التطبيق لفك التشفير والاتصال بـShopify.
- بدون مفتاح صالح يفشل ربط المتجر على الاستضافة برسالة واضحة. في التشغيل المحلي فقط يمكن استخدام مفتاح مؤقت في الذاكرة عند ترك المتغير غير موجود.

تم اختبار الكود والبناء محليًا. لم يتم نشر هذه النسخة إلى حسابك أو اختبار متجر حقيقي أو Firebase الفعلي.
