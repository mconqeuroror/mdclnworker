import { Helmet } from 'react-helmet-async';

export default function SEO({ 
  title = 'ModelClone - AI Identity Recreation & Video Generation',
  description = 'Transform any motion into your personalized video with AI-powered identity recreation. Create professional images and videos with your AI model.',
  keywords = 'AI video generation, identity recreation, deepfake alternative, AI model, video creation, motion transfer',
  ogImage = '/og-image.jpg'
}) {
  const siteUrl = 'https://modelclone.app'; // Update with your domain

  return (
    <Helmet>
      {/* Basic Meta Tags */}
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={keywords} />

      {/* Open Graph */}
      <meta property="og:type" content="website" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={`${siteUrl}${ogImage}`} />
      <meta property="og:url" content={siteUrl} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={`${siteUrl}${ogImage}`} />

      {/* Prefer SeoRobotsMeta (App) for site-wide rules; default is non-indexed */}
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={siteUrl} />
    </Helmet>
  );
}
