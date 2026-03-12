import { Test, TestingModule } from '@nestjs/testing';
import { CashService } from './cash.service';

describe('CashService', () => {
  let service: CashService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CashService],
    }).compile();

    service = module.get<CashService>(CashService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
