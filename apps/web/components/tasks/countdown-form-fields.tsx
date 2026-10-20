"use client";

import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import type { CountdownFormValue } from "@/lib/tasks/countdown";

/** 添加、独立编辑与日历就地编辑共用同一组字段。 */
export function CountdownFormFields({ value, onChange, disabled = false }: {
  value: CountdownFormValue;
  onChange: (value: CountdownFormValue) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className="block space-y-2 text-sm font-medium">标题<Input disabled={disabled} value={value.title} onChange={(event) => onChange({ ...value, title: event.target.value })} placeholder="例如：产品发布会" /></label>
      <label className="block space-y-2 text-sm font-medium">目标日期<Input disabled={disabled} type="date" value={value.target_date} onChange={(event) => onChange({ ...value, target_date: event.target.value })} /></label>
      <label className="flex items-center gap-2 text-sm font-medium"><Checkbox disabled={disabled} checked={value.repeat_annually} onCheckedChange={(checked) => onChange({ ...value, repeat_annually: checked === true })} />每年重复</label>
    </div>
  );
}
