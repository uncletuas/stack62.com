import { FieldDefinition } from './system-definition.schema';

export interface FieldValueValidationError {
  fieldKey: string;
  message: string;
}

export interface FieldValueValidationOptions {
  partial?: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_REGEX = /^https?:\/\/[^\s]+$/i;
const PHONE_REGEX = /^[+\d][\d\s\-()]{5,}$/;
const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === '';
}

function typeError(
  field: FieldDefinition,
  expected: string,
): FieldValueValidationError {
  return {
    fieldKey: field.key,
    message: `${field.name} must be a ${expected}.`,
  };
}

function validateOne(
  field: FieldDefinition,
  value: unknown,
): FieldValueValidationError | null {
  if (isEmptyValue(value)) {
    if (field.required) {
      return {
        fieldKey: field.key,
        message: `${field.name} is required.`,
      };
    }
    return null;
  }

  const config = field.config ?? {};

  switch (field.dataType) {
    case 'text':
    case 'longtext': {
      if (typeof value !== 'string') return typeError(field, 'string');
      const minLength = config.minLength;
      const maxLength = config.maxLength;
      const pattern = config.pattern;
      if (typeof minLength === 'number' && value.length < minLength) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be at least ${minLength} characters.`,
        };
      }
      if (typeof maxLength === 'number' && value.length > maxLength) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be at most ${maxLength} characters.`,
        };
      }
      if (pattern && !new RegExp(pattern).test(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} does not match the required pattern.`,
        };
      }
      return null;
    }

    case 'integer': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return typeError(field, 'integer');
      }
      return validateNumericBounds(field, value, config);
    }

    case 'number':
    case 'currency':
    case 'percentage': {
      const numeric =
        typeof value === 'number'
          ? value
          : typeof value === 'string' && value !== ''
            ? Number(value)
            : NaN;
      if (Number.isNaN(numeric)) return typeError(field, 'number');
      return validateNumericBounds(field, numeric, config);
    }

    case 'boolean': {
      if (typeof value !== 'boolean') return typeError(field, 'boolean');
      return null;
    }

    case 'date':
    case 'datetime': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime())
          ? typeError(field, 'valid date')
          : null;
      }
      if (typeof value !== 'string') return typeError(field, 'date string');
      const parsed = Date.parse(value);
      if (Number.isNaN(parsed)) return typeError(field, 'valid date');
      return null;
    }

    case 'email': {
      if (typeof value !== 'string' || !EMAIL_REGEX.test(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be a valid email address.`,
        };
      }
      return null;
    }

    case 'phone': {
      if (typeof value !== 'string' || !PHONE_REGEX.test(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be a valid phone number.`,
        };
      }
      return null;
    }

    case 'url': {
      if (typeof value !== 'string' || !URL_REGEX.test(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be a valid URL.`,
        };
      }
      return null;
    }

    case 'select': {
      const options = config.options ?? [];
      if (options.length === 0) return null;
      if (typeof value !== 'string' || !options.includes(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} must be one of: ${options.join(', ')}.`,
        };
      }
      return null;
    }

    case 'multiselect': {
      if (!Array.isArray(value)) return typeError(field, 'array');
      const options = config.options ?? [];
      if (options.length > 0) {
        const invalid = value.filter(
          (entry) => typeof entry !== 'string' || !options.includes(entry),
        );
        if (invalid.length > 0) {
          return {
            fieldKey: field.key,
            message: `${field.name} contains invalid options.`,
          };
        }
      }
      return null;
    }

    case 'reference': {
      if (typeof value !== 'string' || !UUID_REGEX.test(value)) {
        return {
          fieldKey: field.key,
          message: `${field.name} must reference a valid record id.`,
        };
      }
      return null;
    }

    case 'file': {
      if (typeof value !== 'string' || value.length === 0) {
        return typeError(field, 'file reference');
      }
      return null;
    }

    case 'json': {
      if (typeof value !== 'object' || value === null) {
        return typeError(field, 'JSON object');
      }
      return null;
    }

    default:
      return null;
  }
}

function validateNumericBounds(
  field: FieldDefinition,
  value: number,
  config: Record<string, unknown>,
): FieldValueValidationError | null {
  const min = config.min as number | undefined;
  const max = config.max as number | undefined;
  if (typeof min === 'number' && value < min) {
    return {
      fieldKey: field.key,
      message: `${field.name} must be at least ${min}.`,
    };
  }
  if (typeof max === 'number' && value > max) {
    return {
      fieldKey: field.key,
      message: `${field.name} must be at most ${max}.`,
    };
  }
  return null;
}

export function validateRecordValues(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
  options: FieldValueValidationOptions = {},
): FieldValueValidationError[] {
  const errors: FieldValueValidationError[] = [];
  const byKey = new Map(fields.map((field) => [field.key, field]));

  for (const key of Object.keys(data)) {
    if (!byKey.has(key)) {
      errors.push({
        fieldKey: key,
        message: `Field '${key}' is not defined on this entity.`,
      });
    }
  }

  for (const field of fields) {
    const hasKey = Object.prototype.hasOwnProperty.call(data, field.key);
    if (!hasKey) {
      if (!options.partial && field.required) {
        errors.push({
          fieldKey: field.key,
          message: `${field.name} is required.`,
        });
      }
      continue;
    }
    const error = validateOne(field, data[field.key]);
    if (error) errors.push(error);
  }

  return errors;
}
