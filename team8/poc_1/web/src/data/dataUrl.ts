/**
 * The ONE place data URLs are resolved. Never write `fetch('/data/...')` —
 * `base: './'` in vite.config.ts means a bare absolute path breaks the moment
 * this deploys to a GitHub Pages subpath.
 *
 * The pipeline writes to web/public/data/. Vite serves public/ at the site root
 * in dev and copies it byte-for-byte into dist/ on build, so one path serves both.
 */
export function dataUrl(path: string): string {
  const base = import.meta.env.BASE_URL;
  return `${base.endsWith('/') ? base : `${base}/`}data/${path.replace(/^\/+/, '')}`;
}
