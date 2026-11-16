// The same way between pages everywhere off the cockpit: Cockpit, Truck, Settings,
// with the current one marked. (The cockpit has its rail; /login is plain HTML in
// brain/src/ops/loginPage.ts and links back the same way.)
const PAGES: [string, string][] = [['/', 'Cockpit'], ['/truck', 'Truck'], ['/settings', 'Settings']];

export function PageNav({ current }: { current: '/' | '/truck' | '/settings' }) {
  return (
    <nav class="page-nav" aria-label="Pages">
      {PAGES.map(([href, label]) => <a href={href} aria-current={current === href ? 'page' : undefined}>{label}</a>)}
    </nav>
  );
}
