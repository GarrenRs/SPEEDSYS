# Restaurants Operational Console

منصة تشغيل مطاعم (Operational Console) مبنية على:
- Frontend: React + Vite + TypeScript
- Backend: FastAPI + SQLAlchemy

## البنية
- `src/` الواجهة الأمامية
- `backend/` واجهة API والخدمات
- `public/` أصول الواجهة الثابتة
- `render.yaml` إعداد النشر على Render

## تشغيل محلي (Development)
1. تثبيت حزم الواجهة:
   - `npm ci`
2. إنشاء بيئة Python وتثبيت الاعتماديات:
   - `python -m venv backend/.venv`
   - `backend/.venv/Scripts/pip install -r backend/requirements.txt`
3. إعداد متغيرات البيئة:
   - انسخ `backend/.env.example` إلى `backend/.env`
4. تشغيل النظام:
   - `npm run dev`

## متغيرات البيئة الأساسية (Backend)
- `APP_ENV` = `production` في بيئة الإنتاج
- `DATABASE_URL` أو `DATABASE_PATH`
- `JWT_SECRET` مفتاح توقيع JWT (طويل وآمن)
- `SECRET_KEY` مفتاح سري إضافي (>= 32 حرف)
- `CORS_ALLOW_ORIGINS` روابط الواجهة المسموح بها (مفصولة بفاصلة)
- `EXPOSE_DIAGNOSTIC_ENDPOINTS` لتفعيل `/health`

## النشر على Render (Blueprint)
هذا المشروع مجهز عبر `render.yaml` بخدمتين:
1. `restaurants-api` (FastAPI)
2. `restaurants-console` (Static Site)

### خطوات النشر
1. ادفع المشروع إلى GitHub.
2. في Render اختر **Blueprint** ثم اربط المستودع.
3. عند إنشاء الخدمات:
   - عيّن قيم `JWT_SECRET` و `SECRET_KEY` يدويًا.
   - راجع `CORS_ALLOW_ORIGINS` وتأكد أنه يطابق رابط الواجهة.
4. بعد نجاح البناء، اختبر:
   - `https://<api-service>.onrender.com/health`
   - الواجهة على رابط الخدمة الثابتة.

## ملاحظات أمنية
- تمت إزالة تعبئة بيانات دخول افتراضية من واجهة تسجيل الدخول.
- لا تقم بتخزين أي أسرار في المستودع.
- استخدم متغيرات البيئة فقط للأسرار.
