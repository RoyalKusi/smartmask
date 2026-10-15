import type { Value } from '../types';

export type Expr =
  | { k: 'col'; table?: string; name: string }
  | { k: 'lit'; v: Value; raw: string }
  | { k: 'star'; table?: string }
  | { k: 'fn'; name: string; args: Expr[]; distinct?: boolean }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'un'; op: string; e: Expr }
  | { k: 'case'; operand?: Expr; whens: { c: Expr; t: Expr }[]; else?: Expr }
  | { k: 'in'; e: Expr; list?: Expr[]; sub?: Query; not: boolean }
  | { k: 'exists'; sub: Query; not: boolean }
  | { k: 'sub'; q: Query }
  | { k: 'between'; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: 'isnull'; e: Expr; not: boolean }
  | { k: 'cast'; e: Expr; type: string };

export interface SelectItem {
  expr: Expr;
  alias?: string;
}

export type TableRef =
  | { k: 'table'; schema?: string; name: string; alias?: string }
  | { k: 'derived'; q: Query; alias: string };

export interface Join {
  type: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';
  src: TableRef;
  on?: Expr;
}

export interface Select {
  k: 'select';
  distinct: boolean;
  items: SelectItem[];
  from?: TableRef;
  joins: Join[];
  where?: Expr;
  groupBy: Expr[];
  having?: Expr;
  orderBy: { e: Expr; desc: boolean }[];
  limit?: number;
  offset?: number;
}

export type QueryBody = Select | { k: 'union'; all: boolean; l: QueryBody; r: QueryBody };

export interface Query {
  ctes: { name: string; cols?: string[]; q: Query }[];
  body: QueryBody;
}
