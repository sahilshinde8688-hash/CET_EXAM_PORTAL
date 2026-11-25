ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS class_level TEXT NOT NULL DEFAULT '';

INSERT INTO public.questions (
  id,
  subject,
  chapter,
  topic,
  sub_topic,
  text,
  options,
  correct_index,
  solution,
  marks,
  negative_marks,
  difficulty,
  is_active,
  class_level
)
VALUES (
  'a6318d28-45a6-4f34-9f8c-f9dc02c94412',
  'Mathematics',
  'Matrices',
  'Matrix Multiplication',
  'Product of Matrices',
  'Let A = [[1, 2], [3, 4]] and B = [[2, 0], [1, 2]]. What is the product AB?',
  ARRAY[
    '[[2, 0], [10, 8]]',
    '[[4, 4], [10, 8]]',
    '[[4, 2], [10, 6]]',
    '[[3, 4], [7, 8]]'
  ],
  1,
  'Multiply each row of A by each column of B: AB = [[1*2 + 2*1, 1*0 + 2*2], [3*2 + 4*1, 3*0 + 4*2]] = [[4, 4], [10, 8]].',
  4,
  1,
  'Medium',
  TRUE,
  '12'
)
ON CONFLICT (id) DO NOTHING;
