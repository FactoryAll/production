export function Footer() {
  const version = process.env.VERSION || 'dev';
  const displayVersion = version.startsWith('v') ? version : `v${version}`;
  return (
    <footer className="w-full border-t border-graphite-200 bg-graphite-surface py-3 text-center text-sm text-graphite-600">
      ProdTrack {displayVersion}
    </footer>
  );
}
