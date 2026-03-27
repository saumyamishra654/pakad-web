"use client";

import { useState, useEffect, useCallback } from "react";

interface SchemaField {
  name: string;
  flag: string;
  flags: string[];
  value_type: string;
  default: unknown;
  choices: string[] | null;
  help: string;
  required: boolean;
  action: string;
  group: string;
}

// Fields already handled by the main form - don't show in advanced
const EXCLUDED_FIELDS = new Set([
  "audio", "output", "tonic", "raga", "source_type", "vocalist_gender",
  "instrument_type", "ingest", "yt", "audio_dir", "filename", "tanpura_key",
  "recorded_audio", "start_time", "end_time",
]);

// Conditional visibility rules (matching local app)
const FIELD_DEPS: Record<string, { field: string; equals?: string | boolean; equalsAny?: string[] }> = {
  force_stem_recompute: { field: "force", equals: true },
};

function cleanLabel(flag: string): string {
  return flag.replace(/^--/, "").replace(/-/g, " ");
}

export function AdvancedOptions({
  mode,
  onChange,
}: {
  mode: string;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const [fields, setFields] = useState<SchemaField[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/schema/${mode}`)
      .then((r) => r.json())
      .then((data) => {
        const advancedFields = (data.fields || []).filter(
          (f: SchemaField) => f.group === "advanced" && !EXCLUDED_FIELDS.has(f.name)
        );
        setFields(advancedFields);
        // Initialize with defaults
        const defaults: Record<string, unknown> = {};
        for (const f of advancedFields) {
          if (f.default != null) defaults[f.name] = f.default;
        }
        setValues(defaults);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [mode]);

  const handleChange = useCallback(
    (name: string, value: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [name]: value };
        // Only send non-default values to parent
        const changed: Record<string, unknown> = {};
        for (const f of fields) {
          const v = next[f.name];
          if (v !== undefined && v !== null && v !== "" && v !== f.default) {
            changed[f.name] = v;
          }
        }
        onChange(changed);
        return next;
      });
    },
    [fields, onChange]
  );

  function isFieldVisible(field: SchemaField): boolean {
    const dep = FIELD_DEPS[field.name];
    if (!dep) return true;
    const depValue = values[dep.field];
    if (dep.equals !== undefined) return depValue === dep.equals;
    if (dep.equalsAny) return dep.equalsAny.includes(depValue as string);
    return true;
  }

  if (loading) return <div className="text-text-faint text-xs">Loading options...</div>;
  if (fields.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-lg p-4 space-y-3">
      {fields.map((field) => {
        if (!isFieldVisible(field)) return null;

        const value = values[field.name];
        const isBool = field.value_type === "bool" || field.action === "store_true" || field.action === "store_false";

        return (
          <div key={field.name}>
            <div className="flex items-center gap-2 mb-1">
              {isBool ? (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={field.action === "store_false" ? !(value as boolean) : !!(value as boolean)}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      handleChange(field.name, field.action === "store_false" ? !checked : checked);
                    }}
                    className="accent-accent"
                  />
                  <span className="text-text-secondary text-xs">{cleanLabel(field.flag)}</span>
                </label>
              ) : (
                <label className="text-text-secondary text-xs">{cleanLabel(field.flag)}</label>
              )}
            </div>

            {!isBool && field.choices && field.choices.length > 0 ? (
              <select
                value={(value as string) ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value || null)}
                className="w-full bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              >
                <option value="">{field.default != null ? String(field.default) : "default"}</option>
                {field.choices.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            ) : !isBool && field.value_type === "int" ? (
              <input
                type="number"
                step="1"
                value={(value as number) ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value ? parseInt(e.target.value) : null)}
                placeholder={field.default != null ? String(field.default) : ""}
                className="w-full bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            ) : !isBool && field.value_type === "float" ? (
              <input
                type="number"
                step="any"
                value={(value as number) ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value ? parseFloat(e.target.value) : null)}
                placeholder={field.default != null ? String(field.default) : ""}
                className="w-full bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            ) : !isBool ? (
              <input
                type="text"
                value={(value as string) ?? ""}
                onChange={(e) => handleChange(field.name, e.target.value || null)}
                placeholder={field.default != null ? String(field.default) : ""}
                className="w-full bg-bg-elevated border border-border rounded-md px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
              />
            ) : null}

            {field.help && (
              <div className="text-text-faint text-[10px] mt-0.5 leading-tight">{field.help}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
