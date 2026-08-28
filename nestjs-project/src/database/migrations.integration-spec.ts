import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Channel } from '../channels/entities/channel.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { CreateUsersAndChannels1775687773260 } from './migrations/1775687773260-CreateUsersAndChannels';
import { CreateAuthTokens1777579850478 } from './migrations/1777579850478-CreateAuthTokens';
import { CreateVideos1787610093430 } from './migrations/1787610093430-CreateVideos';
import { createTestDataSource } from '../test/create-test-data-source';

const MANAGED_TABLES = [
  'users',
  'channels',
  'refresh_tokens',
  'verification_tokens',
  'videos',
];

describe('Database migrations (integration)', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = createTestDataSource(
      [User, Channel, RefreshToken, VerificationToken],
      {
        synchronize: false,
        migrations: [
          CreateUsersAndChannels1775687773260,
          CreateAuthTokens1777579850478,
          CreateVideos1787610093430,
        ],
      },
    );

    await dataSource.initialize();

    // Drop sequentially (not via Promise.all): concurrent `DROP TABLE ...
    // CASCADE` statements that touch FK-related objects race and can deadlock
    // on the shared database.
    for (const table of MANAGED_TABLES) {
      await dataSource.query(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    }
    await dataSource.query(`DROP TABLE IF EXISTS "migrations" CASCADE`);

    // Enum types survive `DROP TABLE`, so a leftover type from a `synchronize`
    // based suite would make `up()` fail with "type already exists". Drop them
    // explicitly to keep this suite independent of execution order.
    await dataSource.query(
      `DROP TYPE IF EXISTS "verification_tokens_type_enum" CASCADE`,
    );
    await dataSource.query(`DROP TYPE IF EXISTS "video_status" CASCADE`);
  });

  afterAll(async () => {
    // The second test undoes the last migration. Re-apply so the shared DB is
    // fully migrated when subsequent suites run.
    await dataSource.runMigrations();
    await dataSource.destroy();
  });

  it('should apply all migrations and create all tables', async () => {
    const ranMigrations = await dataSource.runMigrations();

    expect(ranMigrations).toHaveLength(3);

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])
       ORDER BY table_name`,
      [MANAGED_TABLES],
    );
    const tableNames = result.map((r) => r.table_name);
    expect(tableNames).toEqual([
      'channels',
      'refresh_tokens',
      'users',
      'verification_tokens',
      'videos',
    ]);
  });

  it('should revert the last migration and remove the videos table', async () => {
    await dataSource.undoLastMigration();

    const result = await dataSource.query<{ table_name: string }[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [['videos']],
    );
    expect(result).toHaveLength(0);
  });
});
