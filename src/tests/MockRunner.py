import sys

def main(args):
	print(" ".join(args), file=sys.stderr)
	with open('./args.txt', 'w') as f:
		f.write(" ".join(args))
	return 0

if __name__ == "__main__":
	sys.exit(main(sys.argv[1:]))