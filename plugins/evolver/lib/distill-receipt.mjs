// SPDX-License-Identifier: MIT
// Copyright (c) 2026 EvoMap

// Transport success is not a receipt that persist:true stored both artifacts.
export function outcomeOfDistill(result, usage) {
  const data = result?.data;
  if (!result?.ok) return { status: 'failed', error: String(result?.error), usage };
  const hasId = asset => typeof asset?.asset_id === 'string' && asset.asset_id.trim().length > 0;
  if (data?.ok !== true || data.status !== 'stored' || !hasId(data.gene) || !hasId(data.capsule) || data.quality?.ok === false) {
    return { status: 'failed', error: String(data?.reason ?? `distill_not_persisted:${data?.status ?? 'unknown'}`), data, usage };
  }
  return { status: 'sent', data, usage };
}
