import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

const SITE_URL = 'https://modelclone.app';

/**
 * Only `/` is indexable. Every other route gets noindex,nofollow (including
 * alternate landers like /landing, /create-ai-model, /sk/vytvor-ai-model).
 * Pair with client/public/robots.txt (Allow: /$ + Disallow: /).
 */
export default function SeoRobotsMeta() {
  const { pathname, search } = useLocation();
  const isHome = pathname === '/';

  if (isHome) {
    return (
      <Helmet>
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`${SITE_URL}/`} />
      </Helmet>
    );
  }

  return (
    <Helmet>
      <meta name="robots" content="noindex, nofollow" />
      <link rel="canonical" href={`${SITE_URL}${pathname}${search}`} />
    </Helmet>
  );
}
