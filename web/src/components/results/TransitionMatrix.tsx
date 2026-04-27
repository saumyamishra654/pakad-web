"use client";

export function TransitionMatrix({ data }: { data: { notes: string[]; matrix: number[][] } }) {
  if (data.notes.length === 0) return null;
  const maxVal = Math.max(...data.matrix.flat(), 1);

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <span className="text-text-secondary text-xs font-medium">Note Transition Matrix</span>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="mx-auto">
          <thead>
            <tr>
              <th className="w-6 h-6" />
              {data.notes.map((n, i) => (
                <th key={i} className="text-text-faint text-[9px] font-mono w-6 h-6 text-center">{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((row, i) => (
              <tr key={i}>
                <td className="text-text-faint text-[9px] font-mono text-right pr-1">{data.notes[i]}</td>
                {row.map((val, j) => {
                  const intensity = val / maxVal;
                  return (
                    <td key={j} className="w-6 h-6"
                      style={{ backgroundColor: intensity > 0 ? `rgb(var(--color-accent-teal-rgb) / ${0.1 + intensity * 0.8})` : "transparent" }}
                      title={`${data.notes[i]} -> ${data.notes[j]}: ${val}`} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
