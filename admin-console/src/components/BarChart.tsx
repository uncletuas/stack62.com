/**
 * Tiny dependency-free bar chart (inline SVG). Keeps the admin bundle lean —
 * no charting library. Good enough for growth/revenue trends.
 */
export function BarChart({
  data,
  height = 160,
  color = '#6366f1',
  format = (n: number) => String(n),
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  if (data.length === 0) {
    return <div className="py-8 text-center text-sm text-slate-500">No data yet.</div>;
  }
  const max = Math.max(1, ...data.map((d) => d.value));
  const barW = 100 / data.length;
  // Show at most ~12 labels to avoid crowding.
  const labelEvery = Math.ceil(data.length / 12);

  return (
    <div>
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 20);
          return (
            <rect
              key={i}
              x={i * barW + barW * 0.15}
              y={height - 16 - h}
              width={barW * 0.7}
              height={Math.max(0, h)}
              fill={color}
              rx={0.4}
            >
              <title>{`${d.label}: ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <span key={i} className="flex-1 text-center">
              {d.label.slice(5)}
            </span>
          ) : (
            <span key={i} className="flex-1" />
          ),
        )}
      </div>
    </div>
  );
}
