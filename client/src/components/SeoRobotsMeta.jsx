import { Helmet } from 'react-helmet-async';
import { useLocation } from 'react-router-dom';

const SITE_URL = 'https://modelclone.app';

/**
 * Only `/` is indexable. Every other route gets noindex,nofollow and no
 * canonical (private/app routes should not point crawlers anywhere).
 * Pair with client/public/robots.txt (Allow: /$ + Disallow: /).
 */
export default function SeoRobotsMeta() {
  const { pathname } = useLocation();
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
    </Helmet>
  );
}
