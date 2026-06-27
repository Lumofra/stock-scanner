import { useState } from "react";

interface FilterValues {
  price_min: string;
  price_max: string;
  float_max: string;
  volume_min: string;
  relvol_min: string;
  change_pct_min: string;
  has_news: string;
  sort_by: string;
}

const DEFAULT: FilterValues = {
  price_min: "0.10",
  price_max: "25",
  float_max: "30000000",
  volume_min: "100000",
  relvol_min: "5",
  change_pct_min: "",
  has_news: "",
  sort_by: "rel_vol",
};

function parseNum(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

export function FilterPanel({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<FilterValues>(DEFAULT);
  const [saving, setSaving] = useState(false);

  const set = (key: keyof FilterValues, val: string) =>
    setValues((v) => ({ ...v, [key]: val }));

  async function apply() {
    setSaving(true);
    const body = {
      price_min: parseNum(values.price_min),
      price_max: parseNum(values.price_max),
      float_max: parseNum(values.float_max),
      volume_min: parseNum(values.volume_min),
      relvol_min: parseNum(values.relvol_min),
      change_pct_min: parseNum(values.change_pct_min),
      has_news: values.has_news === "true" ? true : values.has_news === "false" ? false : null,
      sort_by: values.sort_by,
      sort_desc: true,
    };
    await fetch("/api/filters", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    onClose();
  }

  return (
    <div className="bg-[#161b22] border-b border-[#21262d] px-3 py-3">
      <div className="grid grid-cols-4 gap-2 text-xs mb-3">
        <Field label="Price Min" value={values.price_min} onChange={(v) => set("price_min", v)} />
        <Field label="Price Max" value={values.price_max} onChange={(v) => set("price_max", v)} />
        <Field label="Float Max" value={values.float_max} onChange={(v) => set("float_max", v)} placeholder="e.g. 30000000" />
        <Field label="Volume Min" value={values.volume_min} onChange={(v) => set("volume_min", v)} />
        <Field label="Rel Vol Min" value={values.relvol_min} onChange={(v) => set("relvol_min", v)} />
        <Field label="% Chg Min" value={values.change_pct_min} onChange={(v) => set("change_pct_min", v)} placeholder="optional" />

        <div className="flex flex-col gap-1">
          <label className="text-[#8b949e]">Has News</label>
          <select
            value={values.has_news}
            onChange={(e) => set("has_news", e.target.value)}
            className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs"
          >
            <option value="">Any</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[#8b949e]">Sort By</label>
          <select
            value={values.sort_by}
            onChange={(e) => set("sort_by", e.target.value)}
            className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs"
          >
            <option value="rel_vol">Rel Volume</option>
            <option value="change_pct">% Change</option>
            <option value="volume">Volume</option>
            <option value="price">Price</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={apply}
          disabled={saving}
          className="text-xs bg-blue-700 hover:bg-blue-600 text-white rounded px-3 py-1 disabled:opacity-50"
        >
          {saving ? "Applying..." : "Apply"}
        </button>
        <button
          onClick={onClose}
          className="text-xs text-[#8b949e] hover:text-white border border-[#30363d] rounded px-3 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[#8b949e]">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs w-full"
      />
    </div>
  );
}
