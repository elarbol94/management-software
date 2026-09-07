import { z } from "zod";

export const createUserSchema = z.object({
  name: z.string().trim().min(1).max(200),
  username: z.string().trim().min(3).max(254).regex(/^[A-Za-z0-9_.@+-]+$/),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(8).max(128),
  role: z.enum(["member", "personnel", "admin"]),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
