import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const MIGRATION_FILE = /^(\d{8,})_([a-z0-9_]+)\.sql$/;

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function quoteSqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function runQuery({ accessToken, projectRef, query }) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    },
  );

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase database query failed (${response.status}): ${responseText}`);
  }

  return responseText ? JSON.parse(responseText) : [];
}

async function main() {
  const accessToken = requireEnvironment('SUPABASE_ACCESS_TOKEN');
  const projectRef = requireEnvironment('SUPABASE_PROJECT_REF');
  const migrationDirectory = path.resolve('supabase/migrations');
  const fileNames = (await readdir(migrationDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  const migrations = fileNames.map((fileName) => {
    const match = MIGRATION_FILE.exec(fileName);
    if (!match) throw new Error(`Invalid migration filename: ${fileName}`);
    return { fileName, version: match[1], name: match[2] };
  });

  const duplicateVersion = migrations.find(
    (migration, index) => migrations.findIndex((item) => item.version === migration.version) !== index,
  );
  if (duplicateVersion) {
    throw new Error(`Duplicate migration version: ${duplicateVersion.version}`);
  }

  const appliedRows = await runQuery({
    accessToken,
    projectRef,
    query: 'select version from supabase_migrations.schema_migrations order by version;',
  });
  const appliedVersions = new Set(appliedRows.map((row) => String(row.version)));
  const pendingMigrations = migrations.filter(({ version }) => !appliedVersions.has(version));

  if (pendingMigrations.length === 0) {
    console.log('No pending Supabase migrations.');
    return;
  }

  for (const migration of pendingMigrations) {
    console.log(`Applying ${migration.fileName}...`);
    const sql = await readFile(path.join(migrationDirectory, migration.fileName), 'utf8');
    await runQuery({ accessToken, projectRef, query: sql });

    const registrationQuery = [
      'insert into supabase_migrations.schema_migrations(version, name, statements)',
      `values (${quoteSqlLiteral(migration.version)}, ${quoteSqlLiteral(migration.name)}, array[]::text[])`,
      'on conflict(version) do nothing;',
    ].join(' ');
    await runQuery({ accessToken, projectRef, query: registrationQuery });
    console.log(`Applied ${migration.fileName}.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
