import { z } from 'zod'
import { ADVERTISER_TYPES, LISTING_SOURCES } from './enums.ts'

const money = z.number().nonnegative()

/**
 * Per-hunt criteria, stored in `hunts.criteria`. Every field is optional. The
 * database evaluates them (listing_criteria_violations); a listing that breaks
 * one gets a badge but is never hidden.
 */
export const huntCriteriaSchema = z
  .object({
    maxTotalMonthly: money.optional(),
    minRooms: z.number().int().positive().optional(),
    minAreaM2: z.number().positive().optional(),
    allowedDistricts: z.array(z.string()).optional(),
    maxDistanceKm: z.number().positive().optional(),
    /** Pin the distance limit is measured to. guid(): seed ids are not RFC 4122 variants. */
    distancePinId: z.guid().optional(),
    privateOnly: z.boolean().optional(),
    petsAllowed: z.boolean().optional(),
    availableFrom: z.string().date().optional(),
    availableTo: z.string().date().optional(),
    parking: z.boolean().optional(),
    balcony: z.boolean().optional(),
    /** Require an elevator when the flat is above this floor. */
    elevatorAboveFloor: z.number().int().nonnegative().optional(),
    notes: z.string().optional(),
  })
  .refine((c) => !c.availableFrom || !c.availableTo || c.availableFrom <= c.availableTo, {
    message: 'The available-from window ends before it starts',
    path: ['availableTo'],
  })
export type HuntCriteria = z.infer<typeof huntCriteriaSchema>

export const listingFeaturesSchema = z.object({
  elevator: z.boolean().optional(),
  yearBuilt: z.number().int().optional(),
  heating: z.string().optional(),
  furnished: z.boolean().optional(),
  balcony: z.boolean().optional(),
  parking: z.boolean().optional(),
  petsAllowed: z.boolean().optional(),
  rentalTaxNotes: z.string().optional(),
})
export type ListingFeatures = z.infer<typeof listingFeaturesSchema>

/** What every site adapter in packages/parsers produces. */
export const parsedListingSchema = z.object({
  source: z.enum(LISTING_SOURCES),
  url: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
  rent: money.optional(),
  adminFee: money.optional(),
  utilitiesEstimate: money.optional(),
  deposit: money.optional(),
  areaM2: z.number().positive().optional(),
  rooms: z.number().int().positive().optional(),
  floor: z.number().int().optional(),
  totalFloors: z.number().int().optional(),
  address: z.string().optional(),
  district: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  availableFrom: z.string().date().optional(),
  advertiserType: z.enum(ADVERTISER_TYPES).optional(),
  features: listingFeaturesSchema.optional(),
  /** Image URLs in site order, medium-size variant preferred. */
  photos: z.array(z.string().url()).optional(),
  /** Small variant of the first photo, cached as the cover. */
  coverThumbnailUrl: z.string().url().optional(),
})
export type ParsedListing = z.infer<typeof parsedListingSchema>
