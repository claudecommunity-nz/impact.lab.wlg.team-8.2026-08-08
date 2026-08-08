import { ThemeProvider } from './theme/ThemeProvider';
import { Gallery } from './gallery/Gallery';
import { Shell } from './Shell';
import { useRoute } from './nav/route';

/**
 * The ONLY branch here is gallery-vs-product. Week, Streets and Replay are
 * branched inside Shell, below AppProviders — switching them here would remount
 * the providers and reset the week cursor and selection on every tab click.
 */
export function App() {
  const route = useRoute();
  return (
    <ThemeProvider>{route === 'gallery' ? <Gallery /> : <Shell route={route} />}</ThemeProvider>
  );
}
