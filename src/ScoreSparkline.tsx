import {
  Line,
  LineChart,
  ResponsiveContainer,
  YAxis,
} from "recharts";

const defaultColors = [
  "#58a6ff",
  "#3fb950",
  "#d29922",
  "#a371f7",
  "#f778ba",
  "#79c0ff",
];

export function sparkColor(index: number): string {
  return defaultColors[index % defaultColors.length];
}

type Point = { x: number; v: number };

export function ScoreSparkline({
  data,
  color,
}: {
  data: Point[];
  color: string;
}) {
  if (data.length < 2) return null;

  return (
    <div className="score-sparkline-wrap" aria-hidden>
      <ResponsiveContainer width="100%" height={28}>
        <LineChart
          data={data}
          margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
        >
          <YAxis
            type="number"
            domain={["dataMin - 1", "dataMax + 1"]}
            width={0}
            hide
          />
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.25}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
