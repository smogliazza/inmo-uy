import { prisma } from './db';

export interface PasswordPolicy {
    minLength: number;
    requireSpecialChar: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = { minLength: 8, requireSpecialChar: false };

// Returns a user-facing message when the password breaks the policy, or null when it is fine.
export function passwordPolicyError(password: string, policy: PasswordPolicy): string | null {
    if (password.length < policy.minLength) return `Password must be at least ${policy.minLength} characters`;
    if (policy.requireSpecialChar && !/[^A-Za-z0-9]/.test(password)) return 'Password must include at least one special character';
    return null;
}

export async function orgPasswordPolicy(orgId: string): Promise<PasswordPolicy> {
    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { minPasswordLength: true, requirePasswordSpecialChar: true },
    });
    if (!org) return DEFAULT_PASSWORD_POLICY;
    return { minLength: org.minPasswordLength, requireSpecialChar: org.requirePasswordSpecialChar };
}
