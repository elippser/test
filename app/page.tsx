export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div
        className="size-10 animate-spin rounded-full border-2 border-foreground/15 border-t-foreground"
        role="status"
        aria-label="Cargando"
      />
    </div>
  );
}
