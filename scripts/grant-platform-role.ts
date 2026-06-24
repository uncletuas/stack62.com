/**
 * Grant (or revoke) a Stack62 platform role so a user can reach the Assembly.
 *
 *   npx ts-node -r tsconfig-paths/register scripts/grant-platform-role.ts <email> <role>
 *   npx ts-node -r tsconfig-paths/register scripts/grant-platform-role.ts <email> none
 *
 * Roles: super_admin | finance_manager | support_manager | engineer |
 *        security_officer | operations_manager | executive | none
 *
 * Uses the same DataSource config as the TypeORM CLI (DATABASE_* env vars).
 */
import 'reflect-metadata';
import AppDataSource from '../src/data-source';
import { PLATFORM_ROLES } from '../src/shared/access-control/platform-roles';

async function main() {
  const [email, roleArg] = process.argv.slice(2);
  if (!email || !roleArg) {
    console.error(
      'Usage: grant-platform-role.ts <email> <role|none>\nRoles: ' +
        PLATFORM_ROLES.join(', '),
    );
    process.exit(1);
  }

  const role = roleArg === 'none' ? null : roleArg;
  if (role !== null && !(PLATFORM_ROLES as readonly string[]).includes(role)) {
    console.error(`Unknown role "${role}". Valid: ${PLATFORM_ROLES.join(', ')}`);
    process.exit(1);
  }

  await AppDataSource.initialize();
  const result = await AppDataSource.query(
    `UPDATE users SET platform_role = $1, updated_at = now() WHERE lower(email) = lower($2) RETURNING id, email`,
    [role, email],
  );
  await AppDataSource.destroy();

  if (!result?.length) {
    console.error(`No user found with email ${email}.`);
    process.exit(1);
  }
  console.log(
    `✓ ${email} platform_role set to ${role ?? 'NULL (revoked)'} (user ${result[0].id}).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
