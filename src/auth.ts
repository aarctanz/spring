import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";

const ALLOWED_DOMAIN = process.env.GOOGLE_ALLOWED_HD ?? "nitkkr.ac.in";

function isAllowedEmail(email: string): boolean {
  return email.endsWith(`@${ALLOWED_DOMAIN}`);
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  basePath: "/auth",
  baseURL: process.env.APP_BASE_URL,
  trustedOrigins: [process.env.ALLOWED_ORIGIN ?? "http://localhost:5173"],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      hd: ALLOWED_DOMAIN,
      mapProfileToUser: (profile) => ({
        rollNumber: profile.email.split("@")[0],
      }),
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "student",
        input: false,
        returned: true,
      },
      rollNumber: {
        type: "string",
        required: false,
        input: false,
        returned: true,
      },
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  plugins: [openAPI({ disableDefaultReference: true })],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedEmail(user.email)) {
            return false;
          }
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const [row] = await db
            .select({ email: schema.user.email })
            .from(schema.user)
            .where(eq(schema.user.id, session.userId))
            .limit(1);

          if (!row || !isAllowedEmail(row.email)) {
            return false;
          }
        },
      },
    },
  },
});

let _authOpenAPISchema: ReturnType<typeof auth.api.generateOpenAPISchema>;
const getAuthSchema = async () =>
  (_authOpenAPISchema ??= auth.api.generateOpenAPISchema());

export const authOpenAPI = {
  getPaths: (prefix = "/auth") =>
    getAuthSchema().then(({ paths }) => {
      const prefixed: typeof paths = Object.create(null);
      for (const path of Object.keys(paths)) {
        const key = prefix + path;
        prefixed[key] = paths[path];
        for (const method of Object.keys(paths[path])) {
          const operation = (prefixed[key] as any)[method];
          operation.tags = ["Auth"];
        }
      }
      return prefixed;
    }) as Promise<any>,
  getComponents: () =>
    getAuthSchema().then(({ components }) => components) as Promise<any>,
};

export const authPlugin = new Elysia({ name: "auth" })
  .mount(auth.handler)
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });

        if (!session) return status(401);

        return {
          user: session.user,
          session: session.session,
        };
      },
    },
  });
