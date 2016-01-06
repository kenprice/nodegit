import subprocess
import re

testoutput = []
NUMBER_OF_TESTS = 10

for x in range(NUMBER_OF_TESTS):
    p = subprocess.Popen(["npm", "test"], stdout=subprocess.PIPE, shell=True)
    out, err = p.communicate()
    result = float(re.findall("CHECKOUTDONE\[([0-9]+.[0-9]+)\]", out)[0])
    print result
    testoutput.append(result)

sum = 0
for x in testoutput:
    sum += x

print "Avg: " + str(sum / len(testoutput))
