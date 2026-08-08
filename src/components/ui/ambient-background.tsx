/**
 * Static, GPU-cheap replacement for the old WebGL particle field behind the
 * hub: layered navy radial/linear gradients built from the design tokens
 * (no JS, no animation, zero WebGL contexts). Server component — there's
 * nothing here that needs the client.
 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-background">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(61,90,254,0.28) 0%, rgba(5,6,10,0) 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 40% at 85% 60%, rgba(61,90,254,0.14) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(5,6,10,0) 0%, rgba(5,6,10,0.6) 100%)",
        }}
      />
    </div>
  );
}
