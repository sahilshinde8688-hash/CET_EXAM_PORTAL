UPDATE public.questions
SET chapter = 'Matrices'
WHERE lower(trim(subject)) IN ('mathematics', 'math', 'maths')
  AND lower(trim(chapter)) = 'determinants'
  AND COALESCE(class_level, '') IN ('12', '');
