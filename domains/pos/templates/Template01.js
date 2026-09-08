/**
 * Template #01 - Seed Dine-in Layout Specification
 *
 * Canvas: 380x620 (normalized coordinate grid)
 * Sections:
 *   - Indoor (AC, No Smoking):
 *       - Mushola (non-table zone)
 *       - Meja 11 (8 seats)
 *       - Meja 10 (4 seats)
 *       - Meja 9 (4 seats)
 *       - Meja 8 (8 seats)
 *       - Meja 7 (8 seats)
 *       - Meja 6 (4 seats)
 *   - Outdoor / Smoking:
 *       - Meja 2 (4 seats)
 *       - Meja 1 (4 seats)
 *       - Meja 3 (4 seats)
 *       - Meja 4 (4 seats)
 *       - Meja 5 (8 seats, vertical)
 */

const TEMPLATE_01 = {
  id: 'template_01',
  name: 'Template #01 Standard Dine-in Layout',
  description: 'Indoor AC & No-Smoking area with Mushola + Smoking Outdoor area',
  canvas: {
    width: 380,
    height: 620
  },
  sections: [
    {
      id: 'sec_indoor',
      name: 'Indoor Area',
      ac: true,
      smoking: false,
      bounds: { x: 10, y: 10, width: 360, height: 350 }
    },
    {
      id: 'sec_smoking',
      name: 'Smoking Area',
      ac: false,
      smoking: true,
      bounds: { x: 10, y: 370, width: 360, height: 240 }
    }
  ],
  non_table_objects: [
    {
      id: 'obj_mushola',
      type: 'zone',
      label: 'Mushola',
      shape: 'polygon',
      points: [
        { x: 30, y: 30 },
        { x: 130, y: 30 },
        { x: 130, y: 130 },
        { x: 175, y: 130 },
        { x: 175, y: 160 },
        { x: 30, y: 160 }
      ],
      x: 30,
      y: 30,
      width: 145,
      height: 130,
      background_color: '#d6d8db',
      text_color: '#374151'
    }
  ],
  tables: [
    // --- Indoor Section ---
    {
      table_number: '11',
      label: 'meja 11',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 170,
      y: 30,
      width: 170,
      height: 80,
      initial_state: 'available'
    },
    {
      table_number: '10',
      label: 'meja 10',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 240,
      y: 120,
      width: 100,
      height: 80,
      initial_state: 'available'
    },
    {
      table_number: '9',
      label: 'meja 9',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 240,
      y: 210,
      width: 100,
      height: 80,
      initial_state: 'available'
    },
    {
      table_number: '8',
      label: 'meja 8',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 30,
      y: 190,
      width: 170,
      height: 80,
      initial_state: 'available'
    },
    {
      table_number: '7',
      label: 'meja 7',
      capacity: 8,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 30,
      y: 280,
      width: 170,
      height: 80,
      initial_state: 'available'
    },
    {
      table_number: '6',
      label: 'meja 6',
      capacity: 4,
      section_id: 'sec_indoor',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 240,
      y: 300,
      width: 100,
      height: 80,
      initial_state: 'blocked' // Initially unavailable as seen in reference
    },

    // --- Outdoor / Smoking Section ---
    {
      table_number: '2',
      label: 'meja 2',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 35,
      y: 390,
      width: 85,
      height: 70,
      initial_state: 'available'
    },
    {
      table_number: '3',
      label: 'meja 3',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 135,
      y: 390,
      width: 85,
      height: 70,
      initial_state: 'blocked' // Initially unavailable in reference
    },
    {
      table_number: '1',
      label: 'meja 1',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 35,
      y: 480,
      width: 85,
      height: 70,
      initial_state: 'blocked' // Initially unavailable in reference
    },
    {
      table_number: '4',
      label: 'meja 4',
      capacity: 4,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'horizontal',
      x: 135,
      y: 480,
      width: 85,
      height: 70,
      initial_state: 'available'
    },
    {
      table_number: '5',
      label: 'meja 5',
      capacity: 8,
      section_id: 'sec_smoking',
      shape: 'rectangle',
      orientation: 'vertical',
      x: 245,
      y: 390,
      width: 85,
      height: 160,
      initial_state: 'available'
    }
  ]
};

module.exports = TEMPLATE_01;
