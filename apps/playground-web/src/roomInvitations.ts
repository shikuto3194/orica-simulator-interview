export interface InvitationProfile {
  userId: string;
  displayName: string;
  avatarId: string | null;
}
export interface RoomInvitation {
  id: string;
  roomId: string;
  sender: InvitationProfile;
  createdAt: string;
  expiresAt: string;
  readAt: string | null;
  acceptedAt: string | null;
  available: boolean;
}
export interface InvitationInbox {
  invitations: RoomInvitation[];
  unreadCount: number;
}
