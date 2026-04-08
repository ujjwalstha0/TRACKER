import { EntityType, InstrumentType, ListingType } from '../../config/nepse.config';

export class CreateTradeDto {
  symbol!: string;
  isBuy!: boolean;
  price!: number;
  qty!: number;
  broker!: string;
  instrumentType!: InstrumentType;
  entityType!: EntityType;
  listingType!: ListingType;
  purchasedAt?: string;
  soldAt?: string;
  sector?: string;
  notes?: string;
  buyPricePerShare?: number;
}
