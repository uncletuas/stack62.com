import { z } from 'zod';

export const FIELD_DATA_TYPES = [
  'text',
  'longtext',
  'number',
  'integer',
  'currency',
  'percentage',
  'boolean',
  'date',
  'datetime',
  'email',
  'phone',
  'url',
  'select',
  'multiselect',
  'reference',
  'file',
  'json',
] as const;

export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export const fieldDataTypeSchema = z.enum(FIELD_DATA_TYPES);

export function isFieldDataType(value: string): value is FieldDataType {
  return (FIELD_DATA_TYPES as readonly string[]).includes(value);
}
