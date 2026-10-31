import { AVATARS, avatarSrc } from "../avatars";
import type { InvitationProfile as Profile } from "../roomInvitations";

export function InvitationProfile({ profile }: { profile: Profile }) {
  const avatar =
    AVATARS.find((item) => item.id === profile.avatarId) ?? AVATARS[0]!;
  return (
    <span className="invitation-profile">
      <img
        src={avatarSrc(profile.avatarId)}
        alt={`${avatar.name}のアイコン`}
        width={48}
        height={48}
      />
      <span>
        <strong>{profile.displayName}</strong>
        <small>
          {avatar.epithet}・{avatar.name}
        </small>
      </span>
    </span>
  );
}
