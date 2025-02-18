import { v4 as uuidv4 } from 'uuid';

export class Milestone {
  public id: string;
  public owner: string;
  public participants: string[];
  public description: string;
  public timestamp: number;
  public hash: string | null;

  constructor(
    owner: string,
    participants: string[],
    description: string,
    timestamp: number,
    hash: string | null = null,
    id: string = uuidv4()
  ) {
    this.id = id;
    this.owner = owner;
    this.participants = participants;
    this.description = description;
    this.timestamp = timestamp;
    this.hash = hash;
  }

  setHash(hash: string): void {
    this.hash = hash;
  }

  getID(): string {
    return this.id;
  }

  toObject(): { owner: string; participants: string[]; description: string; timestamp: number } {
    return {
      owner: this.owner,
      participants: this.participants,
      description: this.description,
      timestamp: this.timestamp,
    };
  }
}

export const milestoneConverter = {
  toFirestore: (milestone: Milestone): any => {
    return {
      id: milestone.id,
      owner: milestone.owner,
      participants: milestone.participants,
      description: milestone.description,
      timestamp: milestone.timestamp,
      hash: milestone.hash,
    };
  },

  fromFirestore: (snapshot: { data: (options?: any) => any }, options?: any): Milestone => {
    const data = snapshot.data(options);
    return new Milestone(
      data.owner,
      data.participants,
      data.description,
      data.timestamp,
      data.hash,
      data.id
    );
  },
};