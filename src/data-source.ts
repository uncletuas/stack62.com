import 'reflect-metadata';
import { DataSource } from 'typeorm';

const booleanFromEnv = (value: string | undefined, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'stack62',
  ssl: booleanFromEnv(process.env.DATABASE_SSL)
    ? { rejectUnauthorized: false }
    : false,
  synchronize: false,
  logging: booleanFromEnv(process.env.DATABASE_LOGGING),
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
});
