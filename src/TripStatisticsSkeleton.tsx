export function TripStatisticsSkeleton() {
  return (
    <div
      className="flex min-h-[100svh] w-full flex-col items-center bg-[var(--app-page)] pb-32 pt-14"
      aria-hidden="true"
    >
      <div className="mb-6 h-11 w-[320px] rounded-[8px] bg-black/5" />
      <div className="mb-6 h-[345px] w-[320px] rounded-[24px] bg-[#0f172a]/20" />
      <div className="h-[250px] w-[320px] rounded-[24px] bg-[var(--app-card-surface)]" />
    </div>
  );
}
