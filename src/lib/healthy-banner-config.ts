/**
 * Single clearly marked configuration file for owner-provided licensed photos.
 *
 * Leave this array empty by default.
 * If the canteen owner provides their own high-resolution licensed dish photos in the future,
 * add them here. Every entry requires valid src, alt text, photographer/owner credit, and licence.
 */

export interface LicensedBannerPhoto {
  src: string;
  alt: string;
  credit: string;
  licence: string;
}

export const OWNER_LICENSED_BANNER_PHOTOS: LicensedBannerPhoto[] = [];

