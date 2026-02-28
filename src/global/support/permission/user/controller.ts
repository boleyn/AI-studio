type TeamPermissionProps = {
  role?: number;
  isOwner?: boolean;
};

/**
 * Minimal TeamPermission implementation used by the frontend user store.
 * It exposes the same field consumed in this project: hasManagePer.
 */
export class TeamPermission {
  role: number;
  isOwner: boolean;
  hasManagePer: boolean;

  constructor(props: TeamPermissionProps = {}) {
    this.role = props.role ?? 0;
    this.isOwner = Boolean(props.isOwner);

    // Keep behavior permissive for owner and conservative for role bit 0x1 as manage.
    this.hasManagePer = this.isOwner || (this.role & 0b1) === 0b1;
  }
}
