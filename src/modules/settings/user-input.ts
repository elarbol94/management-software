import { z } from "zod";

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role: z.enum(["member", "personnel", "admin"]),
});

export const invitationTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const acceptInvitationSchema = z.object({
  token: invitationTokenSchema,
  nickname: z.string().trim().min(3).max(200).regex(/^[A-Za-z0-9_.@+-]+$/),
  password: z.string().min(8).max(128),
  confirmPassword: z.string().min(8).max(128),
}).refine((data) => data.password === data.confirmPassword, {
  path: ["confirmPassword"],
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
