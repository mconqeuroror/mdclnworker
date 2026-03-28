-- Admin-editable legal pages (Markdown); nullable — built-in copy when null
ALTER TABLE "AppBranding" ADD COLUMN "termsMarkdown" TEXT;
ALTER TABLE "AppBranding" ADD COLUMN "privacyMarkdown" TEXT;
ALTER TABLE "AppBranding" ADD COLUMN "cookiesMarkdown" TEXT;
