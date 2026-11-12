import * as React from "react";
import { CommitInput, Select } from "@/components/ui";
import type { ModelOption } from "@/lib/presets";

const OTHER = "\u0000other";

/**
 * A dropdown of the provider's known models, plus "Other model…" for any ID it doesn't list.
 * A saved model that isn't in the list (typed earlier, or retired since) shows as "Other" with
 * its ID in the field beside it. A provider with no list (Custom) is just the text field.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  label = "Model",
  placeholder = "model-id",
}: {
  models: ModelOption[];
  value: string;
  onChange: (model: string) => void;
  label?: string;
  placeholder?: string;
}) {
  const known = models.some((m) => m.id === value);
  const [other, setOther] = React.useState(!known);
  // Switching provider swaps the list and usually the model; follow whichever the new value is.
  React.useEffect(() => setOther(!models.some((m) => m.id === value)), [models, value]);

  if (models.length === 0) {
    return <CommitInput className="w-60" value={value} placeholder={placeholder} onCommit={onChange} />;
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {other && <CommitInput className="w-48" value={known ? "" : value} placeholder={placeholder} onCommit={(m) => m.trim() && onChange(m.trim())} />}
      <Select
        className="w-64"
        label={label}
        value={other ? OTHER : value}
        onChange={(v) => (v === OTHER ? setOther(true) : onChange(v))}
        options={[...models.map((m) => ({ value: m.id, label: m.label ?? m.id })), { value: OTHER, label: "Other model…" }]}
      />
    </div>
  );
}
