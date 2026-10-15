import { scanAll } from '../../src/shared/data/catalog';
import { dataset } from '../../src/shared/data/dataset';
import { makeTagInfo, schemaLookup, dialectOf, approachOf } from '../../src/shared/data/runtime';
import { TokenVault } from '../../src/shared/engine/masking';
import { runPipeline } from '../../src/shared/engine/pipeline';
import { DEFAULT_POLICY_YAML, parsePolicy } from '../../src/shared/engine/policy';

export const catalog = scanAll('2026-10-15 12:00:00');
export const catalogMap = new Map(catalog.map((r) => [r.id, r]));
export const policy = (() => {
  const p = parsePolicy(DEFAULT_POLICY_YAML).policy;
  if (!p) throw new Error('default policy must parse');
  return p;
})();
export const vault = new TokenVault('test-master-secret');
export const tagInfo = makeTagInfo(catalogMap);

export function run(sql: string, backend = 'core_pg') {
  return runPipeline({
    sql,
    dialect: dialectOf(backend),
    approach: approachOf(backend),
    policy,
    schema: schemaLookup,
    tagInfo,
    provider: dataset,
    vault,
  });
}
