/** Who is calling, as proven by an access token. */
export interface Actor {
  type: 'customer' | 'staff' | 'manager' | 'owner';
  id: string;
  /** Owners, managers and staff. */
  businessId?: string;
  /** Managers: their one branch. Staff: the branch they signed in at. */
  branchId?: string;
  sessionId: string;
}

export type BusinessRole = 'owner' | 'manager' | 'staff';
