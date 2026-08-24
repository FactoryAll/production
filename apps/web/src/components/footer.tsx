export function Footer() {
  const version = process.env.VERSION || 'dev';
  return (
    <footer className="w-full border-t border-graphite-200 bg-graphite-surface py-3 text-center text-sm text-graphite-600">
      ProdTrack v{version}
    </footer>
  );
}
